import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Footer } from '../footer/footer';
import { UserService } from '../user.service';
import { httpResource } from '@angular/common/http';
import { UserStatus } from '../user-status';

export const statusLookup = ['Pending Assignment', 'Processing', 'UNUSED', 'Success', 'Failed'];

export const models = [
  'deepseek-r1:32b',
  'deepseek-r1:14b',
  'deepseek-r1:8b',
  'deepseek-r1:7b',
  'deepseek-r1:1.5b',
  'qwen3:30b',
  'qwen3:14b',
  'qwen3:8b',
  'qwen3:4b',
  'qwen3:1.7b',
  'qwen3:0.6b',
  'devstral:24b',
  'gemma3:27b',
  'gemma3:12b',
  'gemma3:4b',
  'gemma3:1b',
];

@Component({
  selector: 'app-home',
  imports: [DatePipe, RouterLink, Footer, UserStatus],
  templateUrl: './home.html',
  styleUrls: ['./home.scss'],
})
export class Home {
  router = inject(Router);
  userService = inject(UserService);

  models = models;

  queries = httpResource<any[]>(
    () => ({
      url: '/api/queries',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.userService.user()?.id}`,
      },
    }),
    {
      defaultValue: [],
    }
  );
  statusLookup = statusLookup;

  constructor() {
    this.queries.isLoading();
  }

  send(event: SubmitEvent) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const query = formData.get('query');
    const model = formData.get('model');

    if (!query || !model) {
      console.error('Query and model are required');
      return;
    }
    const queryStr = typeof query === 'string' ? query : '';
    if (queryStr.length < 5) {
      console.error('Query must be at least 5 characters long');
      return;
    }

    const userId = this.userService.user()?.id;

    // POST to /api/queries with the data
    fetch('/api/queries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userId}`,
      },
      body: JSON.stringify({ query, model }),
    })
      .then((response) => response.json()) // TODO: Add proper error handling for non-ok responses
      .then((data) => {
        console.log('Server Response:', data);
        this.router.navigate(['/r', data.id]);
      })
      .catch((error) => {
        console.error('Error:', error);
      });
  }
}
