// This file contains setup code for Jest tests

// Set up fetch mock
import { enableFetchMocks } from 'jest-fetch-mock';
enableFetchMocks();

// Silence console output during tests
global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  // Keep error logging enabled for debugging
  // error: jest.fn(),
};

// Add any global setup code here
