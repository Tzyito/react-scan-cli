import { useContext } from 'react';
import { ThemeContext } from '../App';

interface HeaderProps {
  title: string;
  onRefresh: () => void;
}

export default function Header({ title, onRefresh }: HeaderProps) {
  const theme = useContext(ThemeContext);
  return (
    <header style={{ marginBottom: 16 }}>
      <h1 style={{ margin: 0 }}>{title}</h1>
      <small>theme: {theme.mode} · tick: {theme.tick}</small>
      <button onClick={onRefresh} style={{ marginLeft: 12 }}>reset</button>
    </header>
  );
}
