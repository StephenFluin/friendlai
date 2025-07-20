import { Injectable, signal } from '@angular/core';
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
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        this.user.set(JSON.parse(userData));
      } catch (e) {
        console.error('Failed to parse user data from localStorage', e);
      }
    } else {
      this.user.set(this.getAnonymousUser());
    }

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
