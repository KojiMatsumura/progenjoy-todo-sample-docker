import { NextResponse } from "next/server";
import { listChildPrograms } from "@/lib/listChildPrograms";
import { getProgramsAppDir } from "@/lib/paths";

export async function GET() {
  try {
    const programs = await listChildPrograms(getProgramsAppDir());
    return NextResponse.json({ programs });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
