import { Routes } from '@angular/router';
import { PageLayout } from './page-layout/page-layout';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./home/home').then((m) => m.Home),
    pathMatch: 'full',
  },
  {
    path: '',
    pathMatch: 'prefix',
    component: PageLayout,
    children: [
      {
        path: 'r/:id',
        loadComponent: () => import('./results/results').then((m) => m.Results),
      },
      { path: 'm/:id', loadComponent: () => import('./multi-results/multi-results').then((m) => m.MultiResults) },
      { path: 'privacy', loadComponent: () => import('./privacy-policy/privacy-policy').then((m) => m.PrivacyPolicy) },
      { path: 'about', loadComponent: () => import('./about/about').then((m) => m.About) },
      { path: 'multi', loadComponent: () => import('./multi/multi').then((m) => m.Multi) },
      {
        path: 'become-a-provider',
        loadComponent: () => import('./become-a-provider/become-a-provider').then((m) => m.BecomeAProvider),
      },
    ],
  },
];
