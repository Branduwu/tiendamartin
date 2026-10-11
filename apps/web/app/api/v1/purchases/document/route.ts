import { handleDocument } from "../../../../../lib/documents-api";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleDocument(request);
}
