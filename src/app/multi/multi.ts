import { Component, inject } from '@angular/core';
import { models } from '../home/home';
import { User } from '../user';
import { Router, RouterLink } from '@angular/router';
import { httpResource } from '@angular/common/http';

@Component({
  selector: 'app-multi',
  imports: [RouterLink],
  templateUrl: './multi.html',
})
export class Multi {
  userService = inject(User);
  router = inject(Router);

  models = models;

  multiList = httpResource<{ id: string; prompt: string }[]>(() => {
    return {
      url: '/api/multis',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.userService.id}`,
      },
    };
  });
  send(event: SubmitEvent) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const checkedModels = Array.from(form.querySelectorAll('input[name="models[]"]:checked')).map(
      (input) => (input as HTMLInputElement).value
    );
    const formData = new FormData(form);
    const query = formData.get('query');

    console.log(checkedModels);

    if (!query || checkedModels.length < 2) {
      console.error('Query and model are required');
      return;
    }
    const queryStr = typeof query === 'string' ? query : '';
    if (queryStr.length < 5) {
      console.error('Query must be at least 5 characters long');
      return;
    }

    const userId = this.userService.id;

    fetch('/api/multis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userId}`,
      },
      body: JSON.stringify({ query, checkedModels }),
    })
      .then((response) => response.json())
      .then((data) => {
        console.log('Server Response:', data);
        this.router.navigate(['/m/', data.id]);
      })
      .catch((error) => {
        console.error('Error:', error);
      });
  }
}
