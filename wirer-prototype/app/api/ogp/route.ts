import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
        'Accept': 'text/html'
      }
    });
    
    if (!res.ok) {
      throw new Error(`Failed to fetch: ${res.status}`);
    }

    const html = await res.text();
    
    // Simple regex to parse og tags
    const getOg = (property: string) => {
      // Handle <meta property="og:xxx" content="yyy"> or <meta content="yyy" property="og:xxx">
      const match = html.match(new RegExp(`<meta(?:\\s+property="${property}"\\s+content="([^"]*)"|\\s+content="([^"]*)"\\s+property="${property}")`, 'i')) || 
                    html.match(new RegExp(`<meta(?:\\s+name="${property}"\\s+content="([^"]*)"|\\s+content="([^"]*)"\\s+name="${property}")`, 'i'));
      
      // Decode HTML entities roughly if needed
      let content = match ? match[1] || match[2] : null;
      if (content) {
          content = content.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      }
      return content;
    };

    const title = getOg('og:title') || getOg('twitter:title') || html.match(/<title>([^<]*)<\/title>/i)?.[1];
    const description = getOg('og:description') || getOg('twitter:description');
    const image = getOg('og:image') || getOg('twitter:image');
    const video = getOg('og:video:secure_url') || getOg('og:video') || getOg('twitter:player:stream');

    return NextResponse.json({
      status: 'success',
      data: {
        title,
        description,
        image: image ? { url: image } : null,
        video: video ? { url: video } : null,
        publisher: new URL(url).hostname
      }
    });
  } catch (error: any) {
    return NextResponse.json({ status: 'fail', message: error.message }, { status: 500 });
  }
}
