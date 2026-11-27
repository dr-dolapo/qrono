import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * The old live view's address. Lock-screen cards and older notifications open it, so it stays,
 * and goes to the event screen, which is now the live view (the pushdown with Me, All and Messages).
 */
export default function LiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: "/events/[id]", params: { id } }} />;
}
