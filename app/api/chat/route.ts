import { assistant } from '@/lib/assistant/runtime';
import { InputError } from '@/lib/assistant/input';

export const maxDuration = 60;

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    return Response.json(await assistant.chat(input));
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: 400 });
    console.error('Assistant chat error:', error);
    return Response.json({ error: "Ray is a bit busy right now — please try again in a moment." }, { status: 500 });
  }
}
