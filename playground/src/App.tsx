import { useState, useEffect, createContext } from 'react';
import Header from './components/Header';
import UserList from './components/UserList';

export const ThemeContext = createContext({ mode: 'light', tick: 0 });

export default function App() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // 每 100ms 更新一次，8 秒内产生 ~80 次渲染，远超阈值 5
    const id = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(id);
  }, []);

  // Context value 未 memo，每次 App 渲染都创建新对象 → Header 因 context 变化重渲染
  const theme = { mode: 'light' as const, tick };

  return (
    <ThemeContext.Provider value={theme}>
      <div style={{ fontFamily: 'sans-serif', padding: 24 }}>
        <Header
          title="render-inspector playground"
          onRefresh={() => setTick(0)}   // 内联函数，每次渲染新引用
        />
        {/* items 是内联数组，每次渲染新引用 → UserList 因 props.items 变化重渲染 */}
        <UserList items={['Alice', 'Bob', 'Charlie']} tick={tick} />
        <p style={{ color: '#888', fontSize: 12 }}>
          tick: {tick} — 故意制造高频重渲染用于测试
        </p>
      </div>
    </ThemeContext.Provider>
  );
}
