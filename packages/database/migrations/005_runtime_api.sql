-- The password and LOGIN are provisioned separately by the administrator.
BEGIN;
CREATE ROLE smartretail_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT IN ROLE smartretail_app;
COMMIT;
