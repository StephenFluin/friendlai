import { isPlatformServer } from '@angular/common';
import { inject, Injectable, signal, PLATFORM_ID, effect } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { Auth, signInWithPopup, GoogleAuthProvider, signOut as firebaseSignOut, User as FirebaseUser } from '@angular/fire/auth';

export interface User {
  id: string;
  uid?: string;
  name?: string;
  email?: string;
  token?: string;
  isAdmin: boolean;
  type: 'google' | 'anonymous';
}

@Injectable({
  providedIn: 'root',
})
export class UserService {
   user = signal<User | null>(null);

   private auth = inject(Auth);

  constructor() {
    // Short circuit on the server to avoid accessing localStorage
    const platformId = inject(PLATFORM_ID);
    if (isPlatformServer(platformId)) {
      return;
    }

    // Save changes to user to localStorage on update
    effect (() => {
      const user = this.user();
      if (user) {
        localStorage.setItem('user', JSON.stringify(user));
      } else {
        localStorage.removeItem('user');
      }
    });
   

    const userData = localStorage.getItem('user');
    if (userData) {
      try {

        this.user.set(JSON.parse(userData));
      } catch (e) {
        console.error('Failed to parse user data from localStorage', e);
      }
    }
 
    else {
      this.user.set(this.getAnonymousUser());

    }

  }
  async signIn() {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(this.auth, provider);
      const firebaseUser: FirebaseUser = result.user;
      const token = await firebaseUser.getIdToken();

      this.user.set({
        id: this.user()?.id || uuidv4(),
        uid: firebaseUser.uid,
        name: firebaseUser.displayName ?? undefined,
        email: firebaseUser.email ?? undefined,
        token,
        isAdmin: false, // You may want to set this based on your app logic
        type: 'google',
      });
    } catch (error) {
      console.error('Google sign-in failed', error);
    }
  }
  async signOut() {
    await firebaseSignOut(this.auth);
    localStorage.removeItem('user');
    this.user.set(this.getAnonymousUser());
  }
  getAnonymousUser(): User {
      console.log('Creating new anonymous user.');

    return {
      id: uuidv4(),
      isAdmin: false,
      name: 'Anonymous',
      type: 'anonymous',
    };
  }
}
