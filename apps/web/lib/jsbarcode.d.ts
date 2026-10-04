declare module "jsbarcode/bin/barcodes/CODE128/index.js" {
  export class CODE128 {
    constructor(value: string, options: { text: string });
    valid(): boolean;
    encode(): { data: string; text: string };
  }
}
