import { JsonPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [JsonPipe],
  templateUrl: './home.html',
})
export class Home {
  router = inject(Router);
  posts = httpResource<any[]>(() => '/api/queries', { defaultValue: [] });
  constructor() {}

  send(event: SubmitEvent) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const query = formData.get('query');
    console.log('Query:', query);

    // POST to /api/queries with the data
    fetch('/api/queries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    })
      .then((response) => response.json())
      .then((data) => {
        console.log('Server Response:', data);
        this.router.navigate(['/r', data.uuid]);
      })
      .catch((error) => {
        console.error('Error:', error);
      });
  }
}
