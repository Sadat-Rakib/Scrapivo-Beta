# Investor Search Tests

This directory contains tests for the investor search system, including the semantic matching infrastructure.

## Test Types

- **Unit Tests**: Test individual functions and components
- **Property-Based Tests**: Test universal properties across many inputs using fast-check
- **Integration Tests**: Test complete workflows and interactions

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui
```

## Test Coverage

Tests validate:

- Semantic matcher functionality (AI integration, caching, fallback)
- Stage filter exact matching (pre-seed vs seed disambiguation)
- Data validation and cleaning
- Search functionality with all filters
- Performance benchmarks
