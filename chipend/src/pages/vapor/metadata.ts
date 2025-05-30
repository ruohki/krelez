import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ params }) => {
  const respone = await fetch('https://cast.ruohki.services/status-json.xsl');
  const json = await respone.json();

  if (json.icestats?.source) {
    //const chip = json.icestats.source.find((source: any) => source.server_name === 'Chiptune Radio');
    const vapor = json.icestats.source.find((source: any) => source.server_name === 'Vaporwave Radio');
    vapor.listenurl = 'https://krelez.ruohki.dev/vapor/stream';
    return new Response(JSON.stringify(vapor ?? {}), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response('No data found', { status: 404, headers: { 'Content-Type': 'application/json' } });
}