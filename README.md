# json-stream-visit

Simple and efficient streaming JSON processor.

## Example

```typescript
import * as jsonsv from 'json-stream-visit';

const response = await fetch('https://api.example.com/data');
const responseBodyStream = response.body.pipeThrough(new TextDecoderStream());

// Assuming response body looks like:
// {
//   "items": [
//     { "id": "item1", "name": "foo", "data": {...} },
//     { "id": "item2", "name": "bar", "data": {...} },
//     ...
//   ]
// }

await jsonsv.visit(responseBodyStream, {
  items: jsonsv.array({
    id(value) {
      console.log(`Item ID: ${value}`);
    },
    name(value) {
      console.log(`Item name: ${value}`);
    },
  }),
});
```
