import { NextResponse } from "next/server";
import { listChildPrograms } from "@/lib/listChildPrograms";
import { getProgramSitesDir } from "@/lib/paths";

export async function GET() {
  try {
    const programs = await listChildPrograms(getProgramSitesDir());
    return NextResponse.json({ programs });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
