import { Redirect } from 'expo-router';

export default function Index() {
  // Automatically sends the user to your baseline screen on app launch
  return <Redirect href="/baseline" />;
}