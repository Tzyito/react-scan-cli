import { useState, useEffect, createContext } from 'react';
import Header from './components/Header';
import UserList from './components/UserList';

export const ThemeContext = createContext({ mode: 'light', tick: 0 });

export default function App() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // update every 100ms to generate ~80 re-renders over 8s — well above the threshold of 5
    const id = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(id);
  }, []);

  // un-memoized context value: new object on every render → triggers all consumers
  const theme = { mode: 'light' as const, tick };

  return (
    <ThemeContext.Provider value={theme}>
      <div style={{ fontFamily: 'sans-serif', padding: 24 }}>
        <Header
          title="react-scan-cli playground"
          onRefresh={() => setTick(0)}   // inline function: new ref every render
        />
        {/* inline array: new ref every render → UserList re-renders on props.items */}
        <UserList items={['Alice', 'Bob', 'Charlie']} tick={tick} />
        <p style={{ color: '#888', fontSize: 12 }}>
          tick: {tick} — intentional high-frequency re-renders for testing
        </p>
      </div>
    </ThemeContext.Provider>
  );
}
