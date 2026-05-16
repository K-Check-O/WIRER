import Gun from 'gun';
import SEA_module from 'gun/sea';
const SEA = SEA_module || (typeof window !== \'undefined\' ? (window as any).SEA : undefined) || (Gun as any).SEA;
'use client';

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
const GUN_ROOT_NODE = `wirer-proto-hub-${APP_VERSION}`;

const ogpCache = new Map<string, any>();

// OGP展開用のユニバーサルコンポーネント
const LinkPreview = ({ url }: { url: string }) => {
  const [data, setData] = useState<any>(ogpCache.get(url) || null);

  useEffect(() => {
    if (ogpCache.has(url)) {
      setData(ogpCache.get(url));
      return;
    }

    fetch(`/api/ogp?url=${encodeURIComponent(url)}`)
      .then(res => res.json())
      .then(json => {
        if (json.status === 'success' && json.data && (json.data.title || json.data.image)) {
          ogpCache.set(url, json.data);
          setData(json.data);
        }
      })
      .catch(e => console.error("Link preview error:", e));
  }, [url]);

  if (!data) return null;

  return (
    <div className="mt-2 w-full max-w-[400px] border border-border-color bg-surface-hover hover:border-accent transition-colors overflow-hidden">
      {data.video?.url ? (
        <div className="w-full bg-black relative border-b border-border-color">
          <video src={data.video.url} controls className="w-full max-h-[300px] object-contain" />
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
                src={`https://www.youtube.com/embed/${ytMatch[2]}`}
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
                src={`https://open.spotify.com/embed/${spMatch[1]}/${spMatch[2]}?theme=0`} 
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
                src={`https://platform.twitter.com/embed/Tweet.html?id=${xMatch[1]}&theme=dark`}
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
                src={`https://www.instagram.com/p/${igMatch[1]}/embed/captioned`}
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

const MessageItem = memo(({ 
  msg, 
  myWireId, 
  isExpanded, 
  replyLineClamp, 
  toggleReplyExpansion, 
  scrollToMessage, 
  setReplyingTo, 
  handleDeleteMessage 
}: {
  msg: WireMessage,
  myWireId: string,
  isExpanded: boolean,
  replyLineClamp: number,
  toggleReplyExpansion: (key: string) => void,
  scrollToMessage: (key: string) => void,
  setReplyingTo: (msg: WireMessage) => void,
  handleDeleteMessage: (key: string) => void
}) => {
  let statusColorClass = 'border-border-color';
  let senderColorClass = 'text-text-muted';

  if (msg.sender === myWireId) {
    statusColorClass = 'border-accent';
    senderColorClass = 'text-accent';
  } else if (msg.sender.startsWith('GUEST')) {
    statusColorClass = 'border-status-off';
    senderColorClass = 'text-status-off';
  } else if (msg.sender.startsWith('WIRE')) {
    statusColorClass = 'border-text-base';
    senderColorClass = 'text-text-base';
  }

  return (
    <div id={`msg-${msg.key}`} className={`text-sm p-2 border-l-2 ${statusColorClass} bg-surface-hover group relative transition-all duration-300`}>
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0 flex-1">
          <span className={`text-[9px] block uppercase tracking-wider mb-1 ${senderColorClass}`}>
            {msg.sender === myWireId ? 'You' : msg.sender}
          </span>
          {msg.replyTo && (
            <div className="flex items-start gap-2 mb-2">
              <div 
                onClick={() => toggleReplyExpansion(msg.key)}
                className={`flex-1 pl-2 border-l-2 border-border-color/50 text-text-muted text-[10px] opacity-70 cursor-pointer hover:opacity-100 transition-opacity ${
                  isExpanded ? 'break-words whitespace-pre-wrap' : ''
                }`}
                style={!isExpanded ? {
                  display: '-webkit-box',
                  WebkitLineClamp: replyLineClamp,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                } : {}}
                title="Tap to expand/collapse"
              >
                <span className="uppercase tracking-widest pointer-events-none">{msg.replyTo.sender}:</span>
                <span className="pointer-events-none"> {formatMessageText(msg.replyTo.text, true)}</span>
              </div>
              {msg.replyTo.key && (
                <button 
                  onClick={() => scrollToMessage(msg.replyTo!.key)}
                  className="shrink-0 text-text-muted/40 hover:text-accent transition-colors pt-0.5"
                  title="Jump to original message"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6"></path>
                    <path d="M10 14L21 3"></path>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  </svg>
                </button>
              )}
            </div>
          )}
          {msg.deleted ? (
            <span className="text-text-muted italic">[ signal deleted ]</span>
          ) : (
            <span className="text-text-base break-words whitespace-pre-wrap block">{formatMessageText(msg.text)}</span>
          )}
        </div>
        <div className="flex gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 pt-0.5">
          {/* Copy Link Button */}
          {!msg.deleted && (
            <button 
              onClick={() => {
                const url = new URL(window.location.href);
                url.hash = `msg-${msg.key}`;
                navigator.clipboard.writeText(url.toString());
                alert("メッセージへのリンクをコピーしました");
              }}
              className="shrink-0 text-text-muted/40 hover:text-text-base transition-colors duration-300"
              title="Copy Link to Signal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
            </button>
          )}

          {/* Reply Button */}
          {!msg.deleted && (
            <button 
              onClick={() => setReplyingTo(msg)}
              className="shrink-0 text-text-muted/40 hover:text-accent transition-colors duration-300"
              title="Reply to Signal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 17 4 12 9 7"></polyline>
                <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
              </svg>
            </button>
          )}

          {/* Delete Button */}
          {msg.sender === myWireId && !msg.deleted && (
            <button
              onClick={() => handleDeleteMessage(msg.key)}
              className="shrink-0 text-text-muted/40 hover:text-red-500 transition-colors duration-300"
              title="Delete Signal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18"></path>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default function Home() {
  const [wirerModule, setWirerModule] = useState<any>(null);
  const [inputText, setInputText] = useState('');
  const [fontMode, setFontMode] = useState<'default' | 'dot'>('default');
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('dark');
  const [integrity, setIntegrity] = useState<number | null>(null);
  const [messages, setMessages] = useState<WireMessage[]>([]);
  const gunRef = useRef<any>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const [isOnline, setIsOnline] = useState(true);
  const [dotColor, setDotColor] = useState<'red' | 'green'>('red');
  const [showSettings, setShowSettings] = useState(false);
  const [showIntegrity, setShowIntegrity] = useState(false);
  const [deviceMode, setDeviceMode] = useState<'auto' | 'mobile' | 'pc'>('auto');
  const [selectedMessageKeys, setSelectedMessageKeys] = useState<Set<string>>(new Set());
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [replyingTo, setReplyingTo] = useState<WireMessage | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const [replyLineClamp, setReplyLineClamp] = useState<number>(2);

  // Initialize theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('wirer_theme') as 'light' | 'dark';
    if (savedTheme) {
      setThemeMode(savedTheme);
    }
  }, []);

  // Scroll to hash on load
  useEffect(() => {
    if (window.location.hash && messages.length > 0) {
      const id = window.location.hash.substring(1);
      setTimeout(() => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('bg-surface-hover', 'brightness-150');
          setTimeout(() => el.classList.remove('bg-surface-hover', 'brightness-150'), 2000);
        }
      }, 500);
    }
  }, [messages.length]);

  // Apply theme class to document
  useEffect(() => {
    if (themeMode === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem('wirer_theme', themeMode);
  }, [themeMode]);

  const handleScroll = () => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
    }
  };

  useEffect(() => {
    if (isNearBottomRef.current && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // 🔑 擬態ログイン用の状態
  const [myWireId, setMyWireId] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [showAuthForm, setShowAuthForm] = useState<boolean>(false);
  const [isMining, setIsMining] = useState<boolean>(false);
  const [keyPair, setKeyPair] = useState<any>(null);

  const debouncedInput = useDebounce(inputText, 300);

  // ⛏️ スパム防止用のローカルProof of Work
  const minePoW = async (text: string, difficulty: number = 3): Promise<number> => {
    return new Promise((resolve) => {
      // Wasmモジュールがまだロードされていない場合は安全のためスキップ
      if (!wirerModule) {
        resolve(0);
        return;
      }

      setIsMining(true);
      // UIがレンダリングされるよう少し遅延させる
      setTimeout(() => {
        // Wasm（C++）側で高速かつ本格的なPoW演算を実行
        const start = Date.now();
        const nonce = wirerModule.ccall(
          'mine_pow',
          'number',
          ['string', 'number'],
          [text, difficulty]
        );
        console.log(`[Wasm PoW] Found nonce: ${nonce} in ${Date.now() - start}ms`);
        setIsMining(false);
        resolve(nonce);
      }, 50);
    });
  };

  // 🛡️ メアド＋パスワードから「秘密鍵」を計算し、さらに「Wire ID」を作る
  const generateIdentityFromCredentials = async (userEmail: string, userPass: string) => {
    // メアドとパスワードを結合してソルト（塩）を効かせる
    const combinedInput = `WIRER_SALT:${userEmail.toLowerCase().trim()}:${userPass}`;
    const msgUint8 = new TextEncoder().encode(combinedInput);

    // 1回目のハッシュ（秘密鍵の代わりになるシード）
    const secretBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
    const secretArray = Array.from(new Uint8Array(secretBuffer));
    const secretHex = secretArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // 2回目のハッシュ（公開IDの計算）
    const idBuffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretHex));
    const idArray = Array.from(new Uint8Array(idBuffer));
    const idHex = idArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

    return {
      wireId: `WIRE-${idHex.slice(0, 4)}-${idHex.slice(4, 8)}`,
      secret: secretHex
    };
  };

  // 1. 初期の臨時（使い捨て）ID生成とキーペア生成
  const initAnonymousIdentity = async () => {
    
    let storedPair = sessionStorage.getItem('wirer_keypair');
    let pair;
    if (storedPair) {
      pair = JSON.parse(storedPair);
    } else {
      pair = await SEA.pair();
      sessionStorage.setItem('wirer_keypair', JSON.stringify(pair));
    }
    setKeyPair(pair);
    setMyWireId(`GUEST-${pair.pub.slice(0, 4)}-${pair.pub.slice(4, 8)}`);
  };

  // 2. Wasm、Gun.jsの初期化
  useEffect(() => {
    const initApp = async () => {
      // 最初はゲストモードで起動
      await initAnonymousIdentity();

      // Wasmの初期化
      let module: any = null;
      const win = window as any;
      if (win.createWirerCore) {
        module = await win.createWirerCore();
        setWirerModule(module);
      }

      // Gun.jsの初期化 (ローカル中継基地へ接続)
      
      const gun = Gun({
        peers: ['http://localhost:8765/gun']
      });
      gunRef.current = gun;

      // 共通空間の監視
      gun.get(GUN_ROOT_NODE).get('chat').map().on((data: any, key: string) => {
        if (data === null) {
          // 他のピアによる物理削除をハンドル
          setMessages(prev => prev.filter(m => m.key !== key));
          return;
        }

        if (data && data.text !== undefined && data.sender !== undefined) { 
          // `async` inside `gun.on` is okay for simple updates, but since `SEA.verify` is async, we wrap it
          (async () => {
            

            // --- P2P Network Security: Verify Digital Signature ---
            if (!data.pub) return; // 署名がない（古い）メッセージは無視

            const isDeleteAttempt = data.deleted === true && data.deleteSignature;
            if (isDeleteAttempt) {
              const verified = await SEA.verify(data.deleteSignature, data.pub);
              if (!verified) {
                console.warn(`[WIRER SECURITY] Invalid Delete Signature from ${data.sender}. Ignored.`);
                return;
              }
            } else {
              if (!data.signature) return;
              const verified = await SEA.verify(data.signature, data.pub);
              if (!verified) {
                console.warn(`[WIRER SECURITY] Invalid Message Signature from ${data.sender}. Message rejected.`);
                return;
              }
            }

            // --- P2P Network Security: Verify Proof of Work ---
            if (!data.deleted && module) {
              const isValid = module.ccall('verify_pow', 'number', ['string', 'number', 'number'], [data.text, data.nonce || 0, data.difficulty || 4]);
              if (isValid !== 1) {
                console.warn(`[WIRER SECURITY] Invalid PoW detected from ${data.sender}. Message rejected.`);
                return;
              }
            }

          const newMsg: WireMessage = {
            key: key,
            text: data.text,
            sender: data.sender,
            timestamp: data.timestamp,
            deleted: data.deleted || false,
            replyTo: data.replyTo ? JSON.parse(data.replyTo) : undefined,
          };

          setMessages(prev => {
            const existingIndex = prev.findIndex(m => m.key === key);
            if (existingIndex !== -1) {
              // 既存メッセージの更新（例: 削除フラグの変更）
              const updated = [...prev];
              updated[existingIndex] = newMsg;
              return updated.sort((a, b) => a.timestamp - b.timestamp); // 更新後もソートを維持
            }
              // 新規メッセージの追加
              return [...prev, newMsg].sort((a, b) => a.timestamp - b.timestamp);
            });
          })();
        }
      });
    };

    initApp();
  }, []);

  // 3. 入力値が変わった時のC++判定
  useEffect(() => {
    if (wirerModule && debouncedInput) {
      const result = wirerModule.ccall(
        'check_signal_integrity',
        'number',
        ['string'],
        [debouncedInput]
      );
      setIntegrity(result);
    }
  }, [debouncedInput, wirerModule]);

  // 4. メッセージ送信
  const sendMessage = async () => {
    if (!inputText.trim() || !gunRef.current || !myWireId || isMining) return;

    if (integrity !== null && integrity < 50) {
      alert("ノイズが多すぎるため、送信回路が絶縁されました。");
      return;
    }

    // WIRER Logic: スパム防止のための「計算コスト」を課す（PoW）
    const difficulty = 4;
    const nonce = await minePoW(inputText, difficulty); // difficulty 4 (少し重い計算)

    const msgData = {
      text: inputText,
      nonce: nonce,
      difficulty: difficulty,
      timestamp: Date.now(),
      deleted: false,
      replyTo: replyingTo ? JSON.stringify({ key: replyingTo.key, sender: replyingTo.sender, text: replyingTo.text }) : null,
    };

    // WIRER Logic: デジタル署名を付与（本人が書いた証明）
    
    const sig = await SEA.sign(JSON.stringify(msgData), keyPair);

    gunRef.current.get(GUN_ROOT_NODE).get('chat').set({
      ...msgData,
      sender: myWireId,
      pub: keyPair.pub,
      signature: sig
    });

    setInputText('');
    setIntegrity(null);
    setReplyingTo(null);
  };

  // 🔐 クライアントサイドでのWeb3ログイン処理
  const handleWeb3Login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    // 擬似的なログイン：プロトタイプのため簡易的にパスワード等からキーを復元する体で、ローカルから取り出す
    
    let pairStr = localStorage.getItem(`wirer_keypair_${email}`);
    let pair;
    if (pairStr) {
      pair = JSON.parse(pairStr);
    } else {
      pair = await SEA.pair();
      localStorage.setItem(`wirer_keypair_${email}`, JSON.stringify(pair));
    }

    setKeyPair(pair);
    setMyWireId(`WIRE-${pair.pub.slice(0, 4)}-${pair.pub.slice(4, 8)}`);
    setIsLoggedIn(true);
    setShowAuthForm(false);
    alert(`アイデンティティ [WIRE-${pair.pub.slice(0, 4)}] を復元しました。`);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setEmail('');
    setPassword('');
    initAnonymousIdentity();
  };

  // 🗑️ 個別メッセージの削除（論理削除）
  const handleDeleteMessage = async (messageKey: string) => {
    if (!gunRef.current || !keyPair) return;
    if (window.confirm('このシグナルを削除しますか？（他のユーザーからも見えなくなります）')) {
      
      const deleteData = { deleted: true };
      const sig = await SEA.sign(JSON.stringify(deleteData), keyPair);

      gunRef.current.get(GUN_ROOT_NODE).get('chat').get(messageKey).put({ 
        deleted: true,
        deleteSignature: sig,
        pub: keyPair.pub
      });
    }
  };

  // 🗑️ メッセージ選択のトグル
  const toggleMessageSelection = (messageKey: string) => {
    setSelectedMessageKeys(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(messageKey)) {
        newSelection.delete(messageKey);
      } else {
        newSelection.add(messageKey);
      }
      return newSelection;
    });
  };

  // 🗑️ 選択されたメッセージの一括削除
  const handleBulkDelete = () => {
    if (!gunRef.current || selectedMessageKeys.size === 0) return;
    if (window.confirm(`${selectedMessageKeys.size}個のシグナルを削除しますか？（この操作は取り消せません）`)) {
      selectedMessageKeys.forEach(key => {
        gunRef.current.get(GUN_ROOT_NODE).get('chat').get(key).put({ deleted: true });
      });
      setSelectedMessageKeys(new Set()); // 選択をクリア
      setIsDeleteMode(false); // 削除モードを終了
    }
  };

  // 📝 リプライプレビューの展開/折りたたみ切り替え
  const toggleReplyExpansion = (messageKey: string) => {
    setExpandedReplies(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageKey)) {
        newSet.delete(messageKey);
      } else {
        newSet.add(messageKey);
      }
      return newSet;
    });
  };

  // 🔗 メッセージへのスクロールジャンプ
  const scrollToMessage = (key: string) => {
    const el = document.getElementById(`msg-${key}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('bg-surface-hover', 'brightness-150');
      setTimeout(() => el.classList.remove('bg-surface-hover', 'brightness-150'), 2000);
    } else {
      alert("メッセージが見つかりません（削除されたか古すぎる可能性があります）");
    }
  };

  // エンターキー送信ロジック（PC/スマホの判定含む）
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 簡易的なスマホ/タブレット判定（deviceMode設定で上書き可能）
    let isMobile = false;
    if (deviceMode === 'auto') {
      isMobile = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    } else {
      isMobile = deviceMode === 'mobile';
    }

    if (e.key === 'Enter') {
      if (isMobile) {
        // スマホの場合は通常の改行キーとして処理させるため何もしない
        return;
      }

      // PCの場合
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
        // Shift+Enter はブラウザのデフォルト挙動で改行される
        // Ctrl+Enter や Alt+Enter はデフォルトでは改行されないため、手動で改行を挿入する
        if (!e.shiftKey) {
          e.preventDefault();
          const target = e.target as HTMLTextAreaElement;
          const start = target.selectionStart;
          const end = target.selectionEnd;
          setInputText(inputText.substring(0, start) + '\n' + inputText.substring(end));
          
          // ステート反映後にカーソル位置を調整
          setTimeout(() => {
            target.selectionStart = target.selectionEnd = start + 1;
          }, 0);
        }
        return;
      } else {
        // 修飾キーなしの Enter は送信
        e.preventDefault(); // 改行されるのを防ぐ
        sendMessage();
      }
    }
  };

  return (
    <div className={`flex flex-col h-screen bg-app-bg text-text-base p-6 transition-colors duration-300 ${fontMode === 'dot' ? 'font-dot text-sm' : 'font-sans'
      }`}>
      <div className="w-full max-w-lg mx-auto flex flex-col flex-1 min-h-0 space-y-4">
        <div className="shrink-0 relative flex justify-center items-center">
          <h1 className={`text-4xl font-bold flex items-center gap-4 ${fontMode === 'dot' ? 'tracking-tighter' : 'tracking-[0.3em]'}`}>
            W I R E R
            <span
              className={`w-3 h-3 rounded-full animate-pulse ${!isOnline ? 'bg-status-off' : dotColor === 'red' ? 'bg-red-500' : 'bg-green-500'
                }`}
              title={isOnline ? "System Online" : "System Offline"}
            ></span>
          </h1>
          <button
            onClick={() => setShowSettings(true)}
            className="absolute right-0 text-[10px] uppercase tracking-widest text-text-muted hover:text-text-base transition-colors"
          >
            [ SETTINGS ]
          </button>
        </div>

        {/* 🔒 アカウント状態モニター */}
        <div className="shrink-0 border border-border-color p-3 bg-surface flex justify-between items-center text-xs transition-colors duration-300">
          <div className="flex items-center gap-4">
            <span className={`w-2 h-2 rounded-full ${isLoggedIn ? 'bg-accent' : 'bg-status-off'}`}></span>
            <span className="text-text-muted uppercase tracking-widest text-[10px]">
              {isLoggedIn ? 'Secured Identity' : 'Guest Mode'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => isLoggedIn ? handleLogout() : setShowAuthForm(!showAuthForm)}
              className="text-text-muted hover:text-text-base underline text-[10px] uppercase transition-colors"
            >
              {isLoggedIn ? 'Disconnect' : showAuthForm ? 'Close' : 'Sync Account'}
            </button>
          </div>
        </div>

        {/* 🔐 ログインフォームエリア */}
        {showAuthForm && !isLoggedIn && (
          <form onSubmit={handleWeb3Login} className="shrink-0 border border-border-color p-4 bg-surface text-xs space-y-3 animate-fade-in transition-colors duration-300">
            <p className="text-[9px] text-text-muted uppercase tracking-wider">
              ※サーバーへの登録はありません。手元での暗号計算によってIDを復元します。
            </p>
            <div className="space-y-1">
              <label className="text-text-muted uppercase text-[9px]">Email</label>
              <input
                type="email"
                required
                placeholder="example@wire.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface-hover border border-border-color p-2 text-text-base focus:outline-none focus:border-text-muted transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-text-muted uppercase text-[9px]">Password</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface-hover border border-border-color p-2 text-text-base focus:outline-none focus:border-text-muted transition-colors"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-bg-inverse text-text-inverse font-bold uppercase text-[10px] tracking-widest hover:bg-bg-inverse-hover transition-colors"
            >
              Secure Sync
            </button>
          </form>
        )}

        {/* 🆔 現在のWire ID表示 */}
        <div className="shrink-0 text-right text-[10px] text-text-muted tracking-widest">
          ID: <span className="text-text-base font-bold">{myWireId}</span>
        </div>

        {/* 受信メッセージの表示エリア */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 border border-border-color p-4 overflow-y-auto space-y-3 bg-surface transition-colors duration-300 scrollbar-thin"
        >
          <p className="text-[10px] text-text-muted uppercase tracking-widest mb-1">Incoming Wires</p>
          {messages.map((msg) => (
            <MessageItem
              key={msg.key}
              msg={msg}
              myWireId={myWireId}
              isExpanded={expandedReplies.has(msg.key)}
              replyLineClamp={replyLineClamp}
              toggleReplyExpansion={toggleReplyExpansion}
              scrollToMessage={scrollToMessage}
              setReplyingTo={setReplyingTo}
              handleDeleteMessage={handleDeleteMessage}
            />
          ))}
        </div>

        {/* 信号モニター (Debug) */}
        {showIntegrity && (
          <div className="shrink-0 border border-border-color p-4 bg-surface-hover text-center relative transition-colors duration-300 animate-fade-in">
            <span className="text-[10px] text-text-muted absolute top-2 left-4">INTEGRITY</span>
            <div className="text-3xl font-bold mt-1">{integrity !== null ? `${integrity}%` : '--%'}</div>
          </div>
        )}

        {/* 入力と送信 */}
        <div className="shrink-0 space-y-4">
          {replyingTo && (
            <div className="flex justify-between items-center text-[10px] text-text-muted bg-surface p-2 border border-border-color animate-fade-in">
              <div className="line-clamp-1">
                <span className="uppercase tracking-widest text-accent">Replying to {replyingTo.sender}:</span> {replyingTo.text}
              </div>
              <button onClick={() => setReplyingTo(null)} className="shrink-0 ml-4 hover:text-text-base transition-colors px-2 py-1">
                ✕
              </button>
            </div>
          )}
          <textarea
            className={`w-full h-20 bg-transparent border border-border-color p-4 focus:outline-none focus:border-border-focus transition-colors resize-none ${fontMode === 'dot' ? 'text-sm' : 'text-base'
              }`}
            placeholder="Type a wire..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={sendMessage}
            disabled={isMining}
            className={`w-full py-3 text-text-inverse font-bold uppercase text-xs tracking-widest transition-colors ${
              isMining ? 'bg-accent cursor-not-allowed animate-pulse' : 'bg-bg-inverse hover:bg-bg-inverse-hover'
            }`}
          >
            {isMining ? 'Computing Proof-of-Work...' : 'Transmit Signal'}
          </button>
        </div>
      </div>

      {/* Settings Modal (Overlay) */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className={`w-full max-w-sm border border-border-color bg-app-bg shadow-2xl p-6 relative flex flex-col space-y-6 ${fontMode === 'dot' ? 'font-dot' : 'font-sans'
            }`}>
            <button
              onClick={() => setShowSettings(false)}
              className="absolute top-4 right-4 text-text-muted hover:text-text-base transition-colors"
              aria-label="Close settings"
            >
              ✕
            </button>

            <h2 className="text-sm font-bold uppercase tracking-widest text-text-base border-b border-border-color pb-2">
              System Settings
            </h2>

            <div className="space-y-4 text-xs">
              {/* Dot Color Toggle */}
              <div className="flex items-center justify-between">
                <span className="uppercase text-text-muted tracking-wider">Status Dot Color</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDotColor('red')}
                    className={`w-8 h-8 flex items-center justify-center rounded border transition-colors ${dotColor === 'red' ? 'border-red-500 bg-red-500/10' : 'border-border-color hover:border-red-500/50'
                      }`}
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
                  </button>
                  <button
                    onClick={() => setDotColor('green')}
                    className={`w-8 h-8 flex items-center justify-center rounded border transition-colors ${dotColor === 'green' ? 'border-green-500 bg-green-500/10' : 'border-border-color hover:border-green-500/50'
                      }`}
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div>
                  </button>
                </div>
              </div>

              {/* Theme Toggle */}
              <div className="flex items-center justify-between pt-2">
                <span className="uppercase text-text-muted tracking-wider">Theme Mode</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] uppercase tracking-widest ${themeMode === 'dark' ? 'text-text-base font-bold' : 'text-text-muted'}`}>Dark</span>
                  <button
                    onClick={() => setThemeMode(themeMode === 'light' ? 'dark' : 'light')}
                    className={`w-8 h-4 rounded-full relative transition-colors ${themeMode === 'light' ? 'bg-bg-inverse' : 'bg-surface-hover border border-border-color'}`}
                  >
                    <div className={`w-3 h-3 rounded-full ${themeMode === 'light' ? 'bg-text-inverse' : 'bg-text-base'} absolute top-0.5 transition-all ${themeMode === 'light' ? 'left-4' : 'left-0.5'}`} />
                  </button>
                  <span className={`text-[9px] uppercase tracking-widest ${themeMode === 'light' ? 'text-text-base font-bold' : 'text-text-muted'}`}>Light</span>
                </div>
              </div>

              {/* Font Toggle */}
              <div className="flex items-center justify-between pt-2">
                <span className="uppercase text-text-muted tracking-wider">Font Style</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setFontMode('default')}
                    className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded border transition-colors ${fontMode === 'default' ? 'border-text-base text-text-base bg-surface-hover' : 'border-border-color text-text-muted hover:border-text-muted'
                      }`}
                  >
                    Standard
                  </button>
                  <button
                    onClick={() => setFontMode('dot')}
                    className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded border transition-colors ${fontMode === 'dot' ? 'border-text-base text-text-base bg-surface-hover' : 'border-border-color text-text-muted hover:border-text-muted'
                      }`}
                  >
                    Dot-Matrix
                  </button>
                </div>
              </div>

              {/* Integrity Monitor Toggle */}
              <div className="flex items-center justify-between pt-2">
                <span className="uppercase text-text-muted tracking-wider">Show Integrity Monitor</span>
                <button
                  onClick={() => setShowIntegrity(!showIntegrity)}
                  className={`w-8 h-4 rounded-full relative transition-colors ${showIntegrity ? 'bg-text-base' : 'bg-surface-hover border border-border-color'}`}
                >
                  <div className={`w-3 h-3 rounded-full bg-app-bg absolute top-0.5 transition-all ${showIntegrity ? 'left-4' : 'left-0.5'}`} />
                </button>
              </div>

              {/* Device Input Mode Toggle */}
              <div className="flex items-center justify-between pt-2">
                <span className="uppercase text-text-muted tracking-wider">Input Mode (Debug)</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeviceMode('auto')}
                    className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded border transition-colors ${deviceMode === 'auto' ? 'border-text-base text-text-base bg-surface-hover' : 'border-border-color text-text-muted hover:border-text-muted'
                      }`}
                  >
                    Auto
                  </button>
                  <button
                    onClick={() => setDeviceMode('mobile')}
                    className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded border transition-colors ${deviceMode === 'mobile' ? 'border-text-base text-text-base bg-surface-hover' : 'border-border-color text-text-muted hover:border-text-muted'
                      }`}
                  >
                    Mobile
                  </button>
                  <button
                    onClick={() => setDeviceMode('pc')}
                    className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded border transition-colors ${deviceMode === 'pc' ? 'border-text-base text-text-base bg-surface-hover' : 'border-border-color text-text-muted hover:border-text-muted'
                      }`}
                  >
                    PC
                  </button>
                </div>
              </div>

              {/* Reply Lines Toggle */}
              <div className="flex items-center justify-between pt-2">
                <span className="uppercase text-text-muted tracking-wider">Reply Lines Preview</span>
                <input 
                  type="number" 
                  min="1" 
                  max="99" 
                  value={replyLineClamp} 
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val > 0) {
                      setReplyLineClamp(val);
                    }
                  }}
                  className={`w-16 bg-surface-hover border border-border-color p-1 text-right text-[10px] text-text-base focus:outline-none focus:border-text-muted transition-colors ${fontMode === 'dot' ? 'font-dot' : 'font-sans'}`}
                />
              </div>

              {/* Offline Test Toggle (For visual demonstration) */}
              <div className="flex items-center justify-between pt-2">
                <span className="uppercase text-text-muted tracking-wider">Force Offline Mode</span>
                <button
                  onClick={() => setIsOnline(!isOnline)}
                  className={`w-8 h-4 rounded-full relative transition-colors ${!isOnline ? 'bg-text-base' : 'bg-surface-hover border border-border-color'}`}
                >
                  <div className={`w-3 h-3 rounded-full bg-app-bg absolute top-0.5 transition-all ${!isOnline ? 'left-4' : 'left-0.5'}`} />
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}