import { PostgresInventory } from "./database";
import { productId } from "@smartretail/domain";
import { ProductNotFoundError } from "@smartretail/application";
export class ProductImageConflictError extends Error {}
export class ProductImageRateLimitError extends Error {}
export type StoredProductImage = { imageId: string; objectPath: string };
export class PostgresProductImages extends PostgresInventory {
  async listImages() {
    return this.transaction(
      "products.read",
      async (c) =>
        (
          await c.query<{ productId: string; imageId: string }>(
            'SELECT product_id AS "productId",image_id AS "imageId" FROM retail.product_images WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 1000',
            [this.tenant],
          )
        ).rows,
    );
  }
  async assertWrite(id: string, correlationId: string) {
    return this.transaction("products.write", async (c) => {
      const rows = await c.query(
        "SELECT id FROM retail.products WHERE tenant_id=$1 AND id=$2",
        [this.tenant, productId(id)],
      );
      if (!rows.rowCount) throw new ProductNotFoundError();
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "product-photo:" + this.tenant + ":" + this.user,
      ]);
      const count = await c.query<{ n: string }>(
        "SELECT count(*) n FROM retail.product_image_audit WHERE tenant_id=$1 AND actor_user_id=$2 AND operation='photo.change_attempt' AND created_at>clock_timestamp()-interval '1 hour'",
        [this.tenant, this.user],
      );
      if (BigInt(count.rows[0]!.n) >= 60n)
        throw new ProductImageRateLimitError();
      await c.query(
        "INSERT INTO retail.product_image_audit(tenant_id,product_id,actor_user_id,operation,correlation_id) VALUES($1,$2,$3,'photo.change_attempt',$4)",
        [this.tenant, id, this.user, productId(correlationId)],
      );
    });
  }
  async image(id: string): Promise<StoredProductImage | null> {
    return this.transaction("products.read", async (c) => {
      const product = await c.query(
        "SELECT id FROM retail.products WHERE tenant_id=$1 AND id=$2",
        [this.tenant, productId(id)],
      );
      if (!product.rowCount) throw new ProductNotFoundError();
      const rows = await c.query<StoredProductImage>(
        'SELECT image_id AS "imageId",object_path AS "objectPath" FROM retail.product_images WHERE tenant_id=$1 AND product_id=$2',
        [this.tenant, id],
      );
      return rows.rows[0] ?? null;
    });
  }
  async changeImage(
    id: string,
    expected: string | null,
    imageId: string | null,
    correlationId: string,
  ) {
    return this.transaction("products.write", async (c) => {
      const product = await c.query(
        "SELECT id FROM retail.products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [this.tenant, productId(id)],
      );
      if (!product.rowCount) throw new ProductNotFoundError();
      const current = (
        await c.query<StoredProductImage>(
          'SELECT image_id AS "imageId",object_path AS "objectPath" FROM retail.product_images WHERE tenant_id=$1 AND product_id=$2',
          [this.tenant, id],
        )
      ).rows[0];
      if ((current?.imageId ?? null) !== expected)
        throw new ProductImageConflictError();
      if (imageId) {
        const path = `${this.tenant}/${productId(id).toLowerCase()}/${productId(imageId).toLowerCase()}.jpg`;

        await c.query(
          "INSERT INTO retail.product_images(tenant_id,product_id,image_id,object_path,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,product_id) DO UPDATE SET image_id=excluded.image_id,object_path=excluded.object_path,updated_by=excluded.updated_by,updated_at=clock_timestamp()",
          [this.tenant, id, imageId, path, this.user],
        );
      } else
        await c.query(
          "DELETE FROM retail.product_images WHERE tenant_id=$1 AND product_id=$2",
          [this.tenant, id],
        );
      await c.query(
        "INSERT INTO retail.product_image_audit(tenant_id,product_id,actor_user_id,operation,image_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6)",
        [
          this.tenant,
          id,
          this.user,
          imageId ? "photo.replace" : "photo.remove",
          imageId,
          productId(correlationId),
        ],
      );
      return current?.objectPath ?? null;
    });
  }
}
