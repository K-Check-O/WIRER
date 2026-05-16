const fs = require('fs');
let code = fs.readFileSync('app/ChatApp.tsx', 'utf8');

const startCode = 'use client';
import Gun from 'gun';
import SEA_module from 'gun/sea';
const SEA = SEA_module || (typeof window !== 'undefined' ? (window as any).SEA : undefined) || (Gun as any).SEA;

import { useEffect, useState, useRef, memo } from 'react';
import { useDebounce } from './hooks/useDebounce';

interface WireMessage {
  key: string;
  text: string;
  sender: string;
  timestamp: number;
  deleted?: boolean;
  replyTo?: {
    key: string;
    sender: string;
    text: string;
  };
}

// 開発中のキャッシュリセット用。バージョン番号を変更すると全く新しいP2P空間（データベース）が作成されます。
const APP_VERSION = 'v0.1.0';
const GUN_ROOT_NODE = \wirer-proto-hub-\\;

const ogpCache = new Map<string, any>();

// OGP展開用のユニバーサルコンポーネント
const LinkPreview = ({ url }: { url: string }) => {
  const [data, setData] = useState<any>(ogpCache.get(url) || null);
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    if (ogpCache.has(url)) {
      setData(ogpCache.get(url));
      return;
    }

    fetch(\/api/ogp?url=\\)
      .then(res => res.json())
      .then(json => {
        if (json.status === 'success' && json.data && (json.data.title || json.data.image)) {
          ogpCache.set(url, json.data);
          setData(json.data);
        }
      })
      .catch(e => console.error('Link preview error:', e));
  }, [url]);

  if (!data) return null;

  return (
    <div className="mt-2 w-full max-w-[400px] border border-border-color bg-surface-hover hover:border-accent transition-colors overflow-hidden">
      {data.video?.url && !videoError ? (
        <div className="w-full bg-black relative border-b border-border-color">
          <video 
            src={data.video.url} 
            controls 
            className="w-full max-h-[300px] object-contain"
            onError={() => setVideoError(true)}
          />
        </div>
      ) : data.image?.url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block w-full h-32 border-b border-border-color overflow-hidden bg-surface relative group">
          <img src={data.image.url} alt={data.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
        </a>
      ) : null}
      <a href={url} target="_blank" rel="noopener noreferrer" className="block p-3 no-underline group">
        <div className="text-[11px] font-bold text-text-base line-clamp-1 mb-1 group-hover:text-accent transition-colors">{data.title || data.publisher}</div>
        {data.description && <div className="text-[9px] text-text-muted line-clamp-2 mb-2">{data.description}</div>}
        <div className="text-[8px] text-accent uppercase tracking-widest flex items-center gap-1">
          {data.logo?.url && <img src={data.logo.url} className="w-3 h-3 rounded-full" alt="logo" />}
          {new URL(url).hostname.replace(/^www\./, '').replace(/^tnktok\./, 'tiktok.')}
        </div>
      </a>
    </div>
  );
};

const formatMessageText = (text: string, isPreview: boolean = false) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  
  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      try {
        const url = new URL(part);
        const displayDomain = url.hostname.replace(/^www\./, '');
        
        if (isPreview) {
          return <span key={index} className="text-accent underline pointer-events-none">[{displayDomain}]</span>;
        }

        let embedElement = null;

        // YouTube Detection
        const ytRegExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const ytMatch = part.match(ytRegExp);
        if (ytMatch && ytMatch[2].length === 11) {
          embedElement = (
            <div className="mt-2 w-full max-w-[400px] aspect-video border border-border-color bg-app-bg">
              <iframe
                width="100%"
                height="100%"
                src={\https://www.youtube.com/embed/\\}
                title="YouTube Embed"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
          );
        }

        // Spotify Detection
        const spotifyRegExp = /open\.spotify\.com\/(track|album|playlist|episode|artist)\/([a-zA-Z0-9]+)/;
        const spMatch = part.match(spotifyRegExp);
        if (spMatch) {
          const height = spMatch[1] === 'track' ? "152" : "352";
          embedElement = (
            <div className="mt-2 w-full max-w-[400px] border border-border-color bg-app-bg">
              <iframe 
                src={\https://open.spotify.com/embed/\/\?theme=0\} 
                width="100%" 
                height={height} 
                frameBorder="0" 
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" 
                loading="lazy"
              ></iframe>
            </div>
          );
        }

        // X / Twitter Detection
        const xRegExp = /(?:x\.com|twitter\.com)\/[a-zA-Z0-9_]+\/status\/([0-9]+)/;
        const xMatch = part.match(xRegExp);
        if (xMatch) {
          embedElement = (
            <div className="mt-2 w-full max-w-[400px] border border-border-color bg-app-bg overflow-hidden">
              <iframe
                src={\https://platform.twitter.com/embed/Tweet.html?id=\&theme=dark\}
                width="100%"
                height="400"
                frameBorder="0"
                scrolling="yes"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              ></iframe>
            </div>
          );
        }

        // Instagram Detection
        const igRegExp = /instagram\.com\/(?:p|reel)\/([a-zA-Z0-9_-]+)/;
        const igMatch = part.match(igRegExp);
        if (igMatch) {
          embedElement = (
            <div className="mt-2 w-full max-w-[400px] border border-border-color bg-app-bg overflow-hidden">
              <iframe
                src={\https://www.instagram.com/p/\/embed/captioned\}
                width="100%"
                height="480"
                frameBorder="0"
                scrolling="yes"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              ></iframe>
            </div>
          );
        }

        // TikTok Detection (Rewrite to tnktok.com for OGP parsing)
        const tiktokRegExp = /(?:vt\.|lite\.|www\.)?tiktok\.com\/.*/;
        if (part.match(tiktokRegExp) && !embedElement) {
          const tnktokUrl = part.replace(/(?:vt\.|lite\.|www\.)?tiktok\.com/, 'tnktok.com');
          embedElement = <LinkPreview url={tnktokUrl} />;
        }

        // ユニバーサルOGPプレビュー（YouTube/Spotify以外の場合）
        if (!embedElement) {
          embedElement = <LinkPreview url={part} />;
        }

        return (
          <span key={index}>
            <a 
              href={part} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-accent underline hover:brightness-125 transition-all"
              title={part}
            >
              {displayDomain}
            </a>
            {embedElement}
          </span>
        );
      } catch (e) {
        return <span key={index}>{part}</span>;
      }
    }
    return <span key={index}>{part}</span>;
  });
};
\;

const formatIndex = code.indexOf('const MessageItem = memo(({');
if (formatIndex !== -1) {
  code = startCode + '\n' + code.substring(formatIndex);
  fs.writeFileSync('app/ChatApp.tsx', code);
  console.log('Fixed ChatApp.tsx');
} else {
  console.log('Could not find MessageItem');
}
