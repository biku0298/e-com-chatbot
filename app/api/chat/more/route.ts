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
    return Response.json(await assistant.more(input));
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: 400 });
    console.error('Assistant more error:', error);
    return Response.json({ error: "Could not fetch more products. Please try again." }, { status: 500 });
  }
}
