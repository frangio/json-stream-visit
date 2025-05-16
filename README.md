# json-stream-visit

Simple and efficient streaming JSON processor.

## Example

```typescript
import { visit } from 'json-stream-visit';

const response = await fetch('https://api.example.com/data');
const responseBodyStream = response.body.pipeThrough(new TextDecoderStream());

await visit(responseBodyStream, {
  entries: {
    items: {
      values: {
        entries: {
          id(value) {
            console.log(`Item ID: ${value}`);
          },
          name(value) {
            console.log(`Item name: ${value}`);
          }
        }
      }
    }
  }
});
```
