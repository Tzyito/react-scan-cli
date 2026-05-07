interface UserListProps {
  items: string[];
  tick: number;
}

export default function UserList({ items, tick }: UserListProps) {
  return (
    <ul>
      {items.map(name => (
        <li key={name}>{name} — render #{tick}</li>
      ))}
    </ul>
  );
}
