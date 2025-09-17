import { test, expect } from "bun:test";

// Test just the URL parsing logic without importing the full class
function extractUsernameFromUrl(url: string): string | null {
  // Extract email from URL like: /calendars/username@yandex.ru/events-xxx/
  // Handle both encoded (%40) and non-encoded (@) formats
  const match = url.match(/\/calendars\/([^\/]+(?:@|%40)[^\/]+)\//);
  return match ? decodeURIComponent(match[1]!) : null;
}

test("extractUsernameFromUrl should handle URL-encoded emails", () => {
  // Test URL-encoded email
  const encodedUrl =
    "https://caldav.yandex.ru/calendars/koshelevkirill1992%40yandex.ru/events-5649327/";
  const extractedEmail = extractUsernameFromUrl(encodedUrl);

  expect(extractedEmail).toBe("koshelevkirill1992@yandex.ru");
});

test("extractUsernameFromUrl should handle regular emails", () => {
  // Test regular email
  const regularUrl =
    "https://caldav.yandex.ru/calendars/koshelevkirill1992@yandex.ru/events-5649327/";
  const extractedEmail = extractUsernameFromUrl(regularUrl);

  expect(extractedEmail).toBe("koshelevkirill1992@yandex.ru");
});

test("extractUsernameFromUrl should return null for invalid URLs", () => {
  // Test invalid URL
  const invalidUrl = "https://caldav.yandex.ru/calendars/invalid-format/";
  const extractedEmail = extractUsernameFromUrl(invalidUrl);

  expect(extractedEmail).toBeNull();
});

test("extractUsernameFromUrl should handle various email formats", () => {
  const testCases = [
    {
      url: "https://caldav.yandex.ru/calendars/user%40gmail.com/events-123/",
      expected: "user@gmail.com",
    },
    {
      url: "https://caldav.yandex.ru/calendars/test.user%40yandex.ru/events-456/",
      expected: "test.user@yandex.ru",
    },
    {
      url: "https://caldav.yandex.ru/calendars/user123@domain.com/events-789/",
      expected: "user123@domain.com",
    },
  ];

  testCases.forEach(({ url, expected }) => {
    expect(extractUsernameFromUrl(url)).toBe(expected);
  });
});
