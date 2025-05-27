import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';

@Injectable({
  providedIn: 'root',
})
export class User {
  id: string = localStorage?.getItem('userId') || uuidv4();
  constructor() {
    console.log('User ID:', this.id);
    localStorage.setItem('userId', this.id);
  }
}
