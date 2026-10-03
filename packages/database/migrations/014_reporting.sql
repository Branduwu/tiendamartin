BEGIN;
SET LOCAL ROLE smartretail_owner;
ALTER TABLE retail.role_permissions DROP CONSTRAINT role_permissions_permission_check;
ALTER TABLE retail.role_permissions ADD CONSTRAINT role_permissions_permission_check CHECK(permission IN (
'products.read','products.write','locations.read','locations.write','inventory.read','inventory.receive','inventory.issue','inventory.adjust','inventory.transfer','members.manage',
'sales.read','sales.create','sales.return','cash.read','cash.open','cash.move','cash.close','suppliers.read','suppliers.write','purchases.read','purchases.write','purchases.receive','customers.read','customers.write','reports.read'));
INSERT INTO retail.role_permissions VALUES('owner','reports.read'),('admin','reports.read');
COMMIT;
