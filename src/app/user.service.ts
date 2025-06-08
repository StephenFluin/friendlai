import { Injectable, signal } from '@angular/core';

export interface User {
  id: string;
  uid: string;
  name: string;
  email: string;
  token: string;
  isAdmin: boolean;
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
    }
  }
}
