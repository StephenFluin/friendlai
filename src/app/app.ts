import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

declare global {
  interface Window {
    gtag: any;
  }
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styles: [],
})
export class App {
  router = inject(Router);
  title = inject(Title);
  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((n: NavigationEnd) => {
      const pageTitle = this.router.routerState.snapshot.root.children[0].data['title'];
      if (pageTitle) {
        this.title.setTitle(pageTitle);
      } else if (pageTitle !== false) {
        this.title.setTitle('Friendlai');
      }
      try {
        window.gtag('config', 'G-JP6QEC47M1', { page_path: n.urlAfterRedirects });
      } catch (err) {
        // Maybe not in a browser?
      }
    });
  }
}
