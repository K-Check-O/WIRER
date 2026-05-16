'use client';

import { useEffect, useState, useRef } from 'react';
import { useDebounce } from './hooks/useDebounce';

interface WireMessage {
  key: string;
  text: string;
  sender: string;
  timestamp: number;
  deleted?: boolean;
}

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
  const [selectedMessageKeys, setSelectedMessageKeys] = useState<Set<string>>(new Set());
  const [isDeleteMode, setIsDeleteMode] = useState(false);

  // Initialize theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('wirer_theme') as 'light' | 'dark';
    if (savedTheme) {
      setThemeMode(savedTheme);
    }
  }, []);

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

  const debouncedInput = useDebounce(inputText, 300);

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

  // 1. 初期の臨時（使い捨て）ID生成
  const initAnonymousIdentity = async () => {
    // ログインしていない時は、ブラウザごとにランダムなセッションIDを割り振る（Nothingのゲストモード的発想）
    let sessionId = sessionStorage.getItem('wirer_anonymous_id');
    if (!sessionId) {
      const array = new Uint8Array(4);
      window.crypto.getRandomValues(array);
      const hex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      sessionId = `GUEST-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
      sessionStorage.setItem('wirer_anonymous_id', sessionId);
    }
    setMyWireId(sessionId);
  };

  // 2. Wasm、Gun.jsの初期化
  useEffect(() => {
    const initApp = async () => {
      // 最初はゲストモードで起動
      await initAnonymousIdentity();

      // Wasmの初期化
      const win = window as any;
      if (win.createWirerCore) {
        const module = await win.createWirerCore();
        setWirerModule(module);
      }

      // Gun.jsの初期化 (ローカル中継基地へ接続)
      const Gun = (await import('gun' as any)).default;
      const gun = Gun({
        peers: ['http://localhost:8765/gun']
      });
      gunRef.current = gun;

      // 共通空間の監視
      gun.get('wirer-proto-local-hub').get('chat').map().on((data: any, key: string) => {
        if (data === null) {
          // 他のピアによる物理削除をハンドル
          setMessages(prev => prev.filter(m => m.key !== key));
          return;
        }

        if (data && data.text !== undefined && data.sender !== undefined) { // textとsenderが存在することを確認
          const newMsg: WireMessage = {
            key: key,
            text: data.text,
            sender: data.sender,
            timestamp: data.timestamp,
            deleted: data.deleted || false,
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
  const sendMessage = () => {
    if (!inputText.trim() || !gunRef.current || !myWireId) return;

    if (integrity !== null && integrity < 50) {
      alert("ノイズが多すぎるため、送信回路が絶縁されました。");
      return;
    }

    gunRef.current.get('wirer-proto-local-hub').get('chat').set({
      text: inputText,
      sender: myWireId,
      timestamp: Date.now(),
      deleted: false,
    });

    setInputText('');
    setIntegrity(null);
  };

  // 🔐 クライアントサイドでのWeb3ログイン処理
  const handleWeb3Login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    // 入力された情報からIDを決定論的に計算
    const identity = await generateIdentityFromCredentials(email, password);
    
    setMyWireId(identity.wireId);
    setIsLoggedIn(true);
    setShowAuthForm(false);
    alert(`アイデンティティ [${identity.wireId}] を復元しました。`);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setEmail('');
    setPassword('');
    initAnonymousIdentity();
  };

  // 🗑️ 個別メッセージの削除（論理削除）
  const handleDeleteMessage = (messageKey: string) => {
    if (!gunRef.current) return;
    if (window.confirm('このシグナルを削除しますか？（他のユーザーからも見えなくなります）')) {
      // `deleted: true` を書き込むことで論理削除を表現し、全ピアに同期させる
      gunRef.current.get('wirer-proto-local-hub').get('chat').get(messageKey).put({ deleted: true });
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
        gunRef.current.get('wirer-proto-local-hub').get('chat').get(key).put({ deleted: true });
      });
      setSelectedMessageKeys(new Set()); // 選択をクリア
      setIsDeleteMode(false); // 削除モードを終了
    }
  };

  return (
    <div className={`flex flex-col h-screen bg-app-bg text-text-base p-6 transition-colors duration-300 ${
      fontMode === 'dot' ? 'font-dot text-sm' : 'font-sans'
    }`}>
      <div className="w-full max-w-lg mx-auto flex flex-col flex-1 min-h-0 space-y-4">
        <div className="shrink-0 relative flex justify-center items-center">
          <h1 className={`text-4xl font-bold flex items-center gap-4 ${fontMode === 'dot' ? 'tracking-tighter' : 'tracking-[0.3em]'}`}>
            W I R E R
            <span 
              className={`w-3 h-3 rounded-full animate-pulse ${
                !isOnline ? 'bg-status-off' : dotColor === 'red' ? 'bg-red-500' : 'bg-green-500'
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
          {messages.map((msg) => {
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
              <div key={msg.key} className={`text-sm p-2 border-l-2 ${statusColorClass} bg-surface-hover group relative transition-colors duration-300`}>
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <span className={`text-[9px] block uppercase tracking-wider mb-1 ${senderColorClass}`}>
                      {msg.sender === myWireId ? 'You' : msg.sender}
                    </span>
                    {msg.deleted ? (
                      <span className="text-text-muted italic">[ signal deleted ]</span>
                    ) : (
                      <span className="text-text-base break-words whitespace-pre-wrap block">{msg.text}</span>
                    )}
                  </div>
                  {msg.sender === myWireId && !msg.deleted && (
                    <button 
                      onClick={() => handleDeleteMessage(msg.key)} 
                      className="shrink-0 text-text-muted/40 hover:text-red-500 transition-colors duration-300 pt-0.5"
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
            );
          })}
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
          <textarea
            className={`w-full h-20 bg-transparent border border-border-color p-4 focus:outline-none focus:border-border-focus transition-colors resize-none ${
              fontMode === 'dot' ? 'text-sm' : 'text-base'
            }`}
            placeholder="Type a wire..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />
          <button 
            onClick={sendMessage}
            className="w-full py-3 bg-bg-inverse text-text-inverse font-bold uppercase text-xs tracking-widest hover:bg-bg-inverse-hover transition-colors"
          >
            Transmit Signal
          </button>
        </div>
      </div>

      {/* Settings Modal (Overlay) */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className={`w-full max-w-sm border border-border-color bg-app-bg shadow-2xl p-6 relative flex flex-col space-y-6 ${
            fontMode === 'dot' ? 'font-dot' : 'font-sans'
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
                    className={`w-8 h-8 flex items-center justify-center rounded border transition-colors ${
                      dotColor === 'red' ? 'border-red-500 bg-red-500/10' : 'border-border-color hover:border-red-500/50'
                    }`}
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
                  </button>
                  <button 
                    onClick={() => setDotColor('green')}
                    className={`w-8 h-8 flex items-center justify-center rounded border transition-colors ${
                      dotColor === 'green' ? 'border-green-500 bg-green-500/10' : 'border-border-color hover:border-green-500/50'
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
                    className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded border transition-colors ${
                      fontMode === 'default' ? 'border-text-base text-text-base bg-surface-hover' : 'border-border-color text-text-muted hover:border-text-muted'
                    }`}
                  >
                    Standard
                  </button>
                  <button 
                    onClick={() => setFontMode('dot')}
                    className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded border transition-colors ${
                      fontMode === 'dot' ? 'border-text-base text-text-base bg-surface-hover' : 'border-border-color text-text-muted hover:border-text-muted'
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