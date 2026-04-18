export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthResult {
  user: AuthUser;
}

export interface AuthAdapter {
  initialize(): Promise<AuthUser | null>;
  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void;
  signUp(username: string, password: string): Promise<AuthResult>;
  signIn(username: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
}
