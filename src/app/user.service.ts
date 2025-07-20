import { isPlatformServer } from '@angular/common';
import { inject, Injectable, signal, PLATFORM_ID, effect } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';

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
  signIn() {
    // Firebase auth flow for google sign-in
    
  }
  signOut() {
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
