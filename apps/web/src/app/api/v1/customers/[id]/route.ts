import { apiError, getCustomer360 } from "@/lib/customer-os/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await getCustomer360((await params).id)); }
  catch (error) { return apiError(error); }
}
