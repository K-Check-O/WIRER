import { useEffect, useState } from 'react';

/**
 * 連続する高頻度のイベント（タイピングなど）を間引き、
 * 指定された時間が経過した後に最後の値のみを確定させるカスタムフック。
 * WIRERの「スタ連対策」および「Wasm負荷軽減」の防壁として機能します。
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // 指定されたミリ秒（delay）後に値を更新するタイマーをセット
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // 次の文字が打たれたら、前のタイマーをキャンセル（絶縁）する
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}