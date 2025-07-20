import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Footer } from '../footer/footer';
import { UserStatus } from '../user-status';

@Component({
  selector: 'app-page-layout',
  imports: [RouterOutlet, Footer, RouterLink, UserStatus],
  templateUrl: './page-layout.html',
  styles: ``,
})
export class PageLayout {}
