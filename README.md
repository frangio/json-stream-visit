# json-street

Simple and efficient streaming JSON processor.

```
npm install json-street;
```

Process JSON data incrementally without waiting for it to be fully received:

```typescript
import * as jsonst from 'json-street;

const response = await fetch('https://api.example.com/data');
const stream = response.body.pipeThrough(new TextDecoderStream());

const items = [];

await jsonst.visit(stream, {
  items: item => items.push(item),
});

// {
//   "items": [
//     { "id": "1", "name": "foo", "metadata": { ... } },
//     { "id": "2", "name": "bar", "metadata": { ... } },
//     ...
//   ]
// }
```

Specify the expected type of the data to ensure the visitor is appropriately typed:

```typescript
type Data = {
  items: {
    id: string;
    name: string;
    metadata: unknown;
  }[];
};

await jsonst.visit<Data>(stream, /* well-typed visitor */)
```

Use nested visitors to process complex schemas:

```typescript
type User = {
  id: string;
  posts: {
    title: string;
    comments: {
      author: string;
      text: string;
    }[];
  }[];
};

const titles = [];
const comments = [];

await jsonst.visit<User>(stream, {
  posts: jsonst.array({
    title: t => titles.push(t),
    comments: jsonst.array(c => comments.push(c)),
  })
});
```
