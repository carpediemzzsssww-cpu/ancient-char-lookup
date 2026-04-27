import { NextRequest, NextResponse } from 'next/server';
import { parseText, parseDocxBuffer } from '@/lib/parser';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ct = req.headers.get('content-type') || '';
  try {
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!file || !(file instanceof Blob)) {
        return NextResponse.json({ error: 'file 字段缺失' }, { status: 400 });
      }
      const name = (file as File).name || '';
      const buf = Buffer.from(await file.arrayBuffer());
      const entries = name.toLowerCase().endsWith('.docx')
        ? await parseDocxBuffer(buf)
        : parseText(buf.toString('utf8'));
      return NextResponse.json({ entries });
    }
    const body = await req.json();
    const text = String(body?.text ?? '');
    return NextResponse.json({ entries: parseText(text) });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
}
