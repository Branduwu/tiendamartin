BEGIN;
SET LOCAL ROLE smartretail_owner;

DROP FUNCTION IF EXISTS retail.record_sale_return_audit(uuid,uuid,uuid,uuid);
CREATE OR REPLACE FUNCTION retail.record_sale_return_audit(
  p_audit_id uuid,
  p_original_sale_id uuid,
  p_return_id uuid,
  p_request_correlation_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, retail AS $$
DECLARE
  actual_total bigint;
  actual_methods text[];
BEGIN
  IF NOT retail.has_permission('sales.return') THEN
    RAISE EXCEPTION 'Return permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT r.total_minor_units,
    coalesce(array_agg(f.method ORDER BY f.method) FILTER (WHERE f.method IS NOT NULL), ARRAY[]::text[])
  INTO actual_total, actual_methods
  FROM retail.sale_returns r
  LEFT JOIN retail.sale_return_refunds f
    ON f.tenant_id = r.tenant_id AND f.return_id = r.id
  WHERE r.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND r.id = p_return_id
    AND r.sale_id = p_original_sale_id
    AND r.created_tx = pg_current_xact_id()
    AND r.created_by = nullif(current_setting('app.user_id', true), '')::uuid
  GROUP BY r.total_minor_units;
  IF actual_total IS NULL THEN
    RAISE EXCEPTION 'Invalid return audit context' USING ERRCODE = '23514';
  END IF;
  INSERT INTO retail.audit_log(
    id, tenant_id, actor_user_id, action, entity_type, entity_id,
    correlation_id, metadata
  )
  VALUES (
    p_audit_id,
    nullif(current_setting('app.tenant_id', true), '')::uuid,
    nullif(current_setting('app.user_id', true), '')::uuid,
    'sales.return',
    'sale_return',
    p_return_id,
    p_request_correlation_id,
    jsonb_build_object(
      'sale_id', p_original_sale_id::text,
      'total_minor_units', actual_total::text,
      'refund_methods', to_jsonb(actual_methods)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION retail.record_sale_return_audit(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.record_sale_return_audit(uuid,uuid,uuid,uuid) TO smartretail_app;
CREATE POLICY audit_read ON retail.audit_log FOR SELECT
  USING (retail.has_permission('sales.return'));
ALTER TABLE retail.audit_log ADD CONSTRAINT audit_return_fk
  FOREIGN KEY (tenant_id, entity_id) REFERENCES retail.sale_returns(tenant_id, id);

CREATE FUNCTION retail.sale_return_audit_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, retail AS $$
DECLARE expected_metadata jsonb;
BEGIN
  SELECT jsonb_build_object(
    'sale_id', r.sale_id::text,
    'total_minor_units', r.total_minor_units::text,
    'refund_methods', to_jsonb(coalesce(array_agg(f.method ORDER BY f.method)
      FILTER (WHERE f.method IS NOT NULL), ARRAY[]::text[])))
  INTO expected_metadata
  FROM retail.sale_returns r LEFT JOIN retail.sale_return_refunds f
    ON f.tenant_id=r.tenant_id AND f.return_id=r.id
  WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.id
  GROUP BY r.sale_id,r.total_minor_units;
  IF NOT EXISTS (SELECT 1 FROM retail.audit_log a
    WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.id
      AND a.actor_user_id=NEW.created_by AND a.action='sales.return'
      AND a.entity_type='sale_return' AND a.metadata=expected_metadata) THEN
    RAISE EXCEPTION 'Return audit incomplete' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION retail.sale_return_audit_complete() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER sale_return_audit_complete
  AFTER INSERT ON retail.sale_returns DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION retail.sale_return_audit_complete();
COMMIT;
