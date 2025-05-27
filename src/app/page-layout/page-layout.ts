import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Footer } from '../footer/footer';

@Component({
  selector: 'app-page-layout',
  imports: [RouterOutlet, Footer, RouterLink],
  templateUrl: './page-layout.html',
  styles: ``,
})
export class PageLayout {}
