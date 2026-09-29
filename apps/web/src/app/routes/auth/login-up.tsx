import { LoginPage } from './login';

/** Unlisted sign-in page with email + password as well as Google — reached only by typing its URL. */
export default function LoginUpRoute() {
  return <LoginPage withPassword />;
}
