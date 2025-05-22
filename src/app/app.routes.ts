import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./home/home').then((m) => m.Home),
  },
  {
    path: 'r/:id',
    loadComponent: () => import('./results/results').then((m) => m.Results),
  },
];
