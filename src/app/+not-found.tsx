import { Redirect } from 'expo-router';

/**
 * Any address that no longer exists (e.g. a screen restored from an older version of the app)
 * goes Home instead of showing an error.
 */
export default function NotFound() {
  return <Redirect href="/" />;
}
