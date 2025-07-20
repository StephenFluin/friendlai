import { Component, inject, signal } from '@angular/core';
import { UserService } from './user.service';

@Component({
  selector: 'app-user-status',
  template: `
    <div class="user-menu" (click)="toggleMenu()" tabindex="0" (blur)="closeMenu()" [attr.aria-expanded]="menuOpen">
      <span class="user-icon">
        @if (!user()) {
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/>
            <path d="M4 20c0-4 8-4 8-4s8 0 8 4" stroke="currentColor" stroke-width="2"/>
          </svg>
        } @else {
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/>
            <path d="M4 20c0-4 8-4 8-4s8 0 8 4" stroke="currentColor" stroke-width="2"/>
          </svg>
        }
      </span>
      @if (user()) {
        <span class="user-name">{{user()?.name || 'User'}}</span>
      }
      @if (menuOpen()) {
        <div class="user-dropdown">
            @if(user()?.type === 'anonymous') {
              <button (click)="signOut($event)">Reset</button>
              <button (click)="signIn($event)">Sign In</button>
            } @else if(user()?.type === 'google') {
              <button (click)="signOut($event)">Sign Out</button>
            }
        </div>
      }
    </div>
  `,
  styles: [`
    .user-menu {
      position: relative;
      display: flex;
      align-items: center;
      cursor: pointer;
      outline: none;
    }
    .user-icon {
      margin-right: 0.5rem;
      color: var(--fai-color-primary);
    }
    .user-name {
      font-size: 1rem;
      color: var(--fai-color-text);
    }
    .user-dropdown {
      position: absolute;
      right: 0;
      top: 2.5rem;
      background: var(--fai-color-bg-00);
      border: 1px solid var(--fai-color-border);
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 100;
      min-width: 120px;
      padding: 0.5rem 0;
      display: flex;
      flex-direction: column;
    }
    .user-dropdown button {
      background: none;
      border: none;
      color: var(--fai-color-text);
      padding: 0.5rem 1rem;
      text-align: left;
      cursor: pointer;
      width: 100%;
    }
    .user-dropdown button:hover {
      background: var(--fai-color-steel-70);
    }
  `]
})
export class UserStatus {
  userService = inject(UserService);
  user = this.userService.user.asReadonly();
  menuOpen = signal(false);

  toggleMenu() {
    this.menuOpen.set(!this.menuOpen());
  }
  closeMenu() {
    setTimeout(() => this.menuOpen.set(false), 100); // Delay to allow click
  }
  signIn(event: Event) {
    event.stopPropagation();
    this.userService.signIn();
    this.menuOpen.set(false);
  }
  signOut(event: Event) {
    event.stopPropagation();
    this.userService.signOut();
    
    this.menuOpen.set(false);
  }
}