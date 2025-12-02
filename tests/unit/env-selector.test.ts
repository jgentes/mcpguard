import * as path from 'path'
import type * as readline from 'readline'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getEnvVarsFromFile,
  selectEnvVarsInteractively,
} from '../../src/utils/env-selector.js'

// Mock readline for interactive function
const mockQuestion = vi.fn()
const mockClose = vi.fn()
const mockRL = {
  question: mockQuestion,
  close: mockClose,
} as unknown as readline.Interface

vi.mock('readline', () => ({
  createInterface: vi.fn(() => mockRL),
}))

// Mock fs module
const mockFiles: Map<string, string> = new Map()
vi.mock('fs', () => ({
  existsSync: vi.fn((filePath: string) => mockFiles.has(filePath)),
  readFileSync: vi.fn((filePath: string) => {
    const content = mockFiles.get(filePath)
    if (content === undefined) {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }
    return content
  }),
}))

describe('env-selector', () => {
  let mockCwd: string
  let mockEnvPath: string

  beforeEach(() => {
    mockCwd = '/test/dir'
    mockEnvPath = path.join(mockCwd, '.env')

    // Mock process.cwd()
    vi.spyOn(process, 'cwd').mockReturnValue(mockCwd)

    // Clear mock files
    mockFiles.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockFiles.clear()
  })

  describe('getEnvVarsFromFile', () => {
    it('should return empty object when .env file does not exist', () => {
      const envVars = getEnvVarsFromFile()
      expect(envVars).toEqual({})
    })

    it('should parse basic KEY=VALUE format', () => {
      mockFiles.set(
        mockEnvPath,
        'TEST_KEY=test_value\nANOTHER_KEY=another_value',
      )

      const envVars = getEnvVarsFromFile()
      expect(envVars).toEqual({
        TEST_KEY: 'test_value',
        ANOTHER_KEY: 'another_value',
      })
    })

    it('should skip comments', () => {
      mockFiles.set(
        mockEnvPath,
        '# This is a comment\nTEST_KEY=test_value\n# Another comment',
      )

      const envVars = getEnvVarsFromFile()
      expect(envVars).toEqual({
        TEST_KEY: 'test_value',
      })
    })

    it('should skip empty lines', () => {
      mockFiles.set(
        mockEnvPath,
        'TEST_KEY=test_value\n\nANOTHER_KEY=another_value\n',
      )

      const envVars = getEnvVarsFromFile()
      expect(envVars).toEqual({
        TEST_KEY: 'test_value',
        ANOTHER_KEY: 'another_value',
      })
    })

    it('should remove quotes from values', () => {
      mockFiles.set(
        mockEnvPath,
        'TEST_KEY="quoted_value"\nANOTHER_KEY=\'single_quoted\'',
      )

      const envVars = getEnvVarsFromFile()
      expect(envVars).toEqual({
        TEST_KEY: 'quoted_value',
        ANOTHER_KEY: 'single_quoted',
      })
    })

    it('should handle values with spaces', () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=value with spaces')

      const envVars = getEnvVarsFromFile()
      expect(envVars).toEqual({
        TEST_KEY: 'value with spaces',
      })
    })

    it('should handle values with equals signs', () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=value=with=equals')

      const envVars = getEnvVarsFromFile()
      expect(envVars).toEqual({
        TEST_KEY: 'value=with=equals',
      })
    })

    it('should only match valid variable names', () => {
      mockFiles.set(
        mockEnvPath,
        'VALID_KEY=value\n123INVALID=value\nINVALID-KEY=value\n_VALID=value',
      )

      const envVars = getEnvVarsFromFile()
      expect(envVars).toEqual({
        VALID_KEY: 'value',
        _VALID: 'value',
      })
    })

    it('should handle empty values', () => {
      mockFiles.set(mockEnvPath, 'EMPTY_KEY=')

      const envVars = getEnvVarsFromFile()
      expect(envVars).toEqual({
        EMPTY_KEY: '',
      })
    })
  })

  describe('selectEnvVarsInteractively', () => {
    beforeEach(() => {
      mockQuestion.mockReset()
      mockClose.mockReset()
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should return empty object when skip is entered', async () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=test_value')
      mockQuestion.mockImplementationOnce(
        (_prompt: string, callback: (answer: string) => void) => {
          callback('skip')
        },
      )

      const result = await selectEnvVarsInteractively(mockRL)
      expect(result).toEqual({})
    })

    it('should return empty object when no env vars exist and skip', async () => {
      mockQuestion.mockImplementationOnce(
        (_prompt: string, callback: (answer: string) => void) => {
          callback('skip')
        },
      )

      const result = await selectEnvVarsInteractively(mockRL)
      expect(result).toEqual({})
    })

    it('should select env var by number', async () => {
      mockFiles.set(
        mockEnvPath,
        'TEST_KEY=test_value\nANOTHER_KEY=another_value',
      )
      let callCount = 0
      mockQuestion.mockImplementation(
        (_prompt: string, callback: (answer: string) => void) => {
          callCount++
          if (callCount === 1) {
            callback('2') // Select second one (ANOTHER_KEY is first alphabetically)
          } else if (callCount === 2) {
            callback('done')
          }
        },
      )

      const result = await selectEnvVarsInteractively(mockRL)
      // Keys are sorted alphabetically, so ANOTHER_KEY is 1, TEST_KEY is 2
      expect(result).toEqual({
        // biome-ignore lint/suspicious/noTemplateCurlyInString: This is the expected format
        TEST_KEY: '${TEST_KEY}',
      })
    })

    it('should handle done command', async () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=test_value')
      mockQuestion.mockImplementationOnce(
        (_prompt: string, callback: (answer: string) => void) => {
          callback('done')
        },
      )

      const result = await selectEnvVarsInteractively(mockRL)
      expect(result).toEqual({})
    })

    it('should handle manual JSON input', async () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=test_value')
      let callCount = 0
      mockQuestion.mockImplementation(
        (_prompt: string, callback: (answer: string) => void) => {
          callCount++
          if (callCount === 1) {
            callback('manual')
          } else if (callCount === 2) {
            callback('{"API_KEY": "test-api-key"}')
          }
        },
      )

      const result = await selectEnvVarsInteractively(mockRL)
      expect(result).toEqual({
        API_KEY: 'test-api-key', // Not in .env, so used as-is
      })
    })

    it('should convert manual JSON values to ${VAR_NAME} if key exists in .env', async () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=test_value')
      let callCount = 0
      mockQuestion.mockImplementation(
        (_prompt: string, callback: (answer: string) => void) => {
          callCount++
          if (callCount === 1) {
            callback('manual')
          } else if (callCount === 2) {
            callback('{"TEST_KEY": "some-value"}')
          }
        },
      )

      const result = await selectEnvVarsInteractively(mockRL)
      expect(result).toEqual({
        // biome-ignore lint/suspicious/noTemplateCurlyInString: This is the expected format
        TEST_KEY: '${TEST_KEY}', // Key exists in .env, so converted to ${VAR_NAME}
      })
    })

    it('should handle invalid number input', async () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=test_value')
      let callCount = 0
      mockQuestion.mockImplementation(
        (_prompt: string, callback: (answer: string) => void) => {
          callCount++
          if (callCount === 1) {
            callback('999') // Invalid number
          } else if (callCount === 2) {
            callback('done')
          }
        },
      )

      const result = await selectEnvVarsInteractively(mockRL)
      expect(result).toEqual({})
    })

    it('should handle already selected env var', async () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=test_value')
      let callCount = 0
      mockQuestion.mockImplementation(
        (_prompt: string, callback: (answer: string) => void) => {
          callCount++
          if (callCount === 1) {
            callback('1')
          } else if (callCount === 2) {
            callback('1') // Try to select again
          } else if (callCount === 3) {
            callback('done')
          }
        },
      )

      const result = await selectEnvVarsInteractively(mockRL)
      expect(result).toEqual({
        // biome-ignore lint/suspicious/noTemplateCurlyInString: This is the expected format
        TEST_KEY: '${TEST_KEY}',
      })
    })

    it('should handle invalid JSON in manual mode', async () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=test_value')
      let callCount = 0
      mockQuestion.mockImplementation(
        (_prompt: string, callback: (answer: string) => void) => {
          callCount++
          if (callCount === 1) {
            callback('manual')
          } else if (callCount === 2) {
            callback('invalid json{')
          } else if (callCount === 3) {
            callback('done')
          }
        },
      )

      const result = await selectEnvVarsInteractively(mockRL)
      expect(result).toEqual({})
    })

    it('should handle empty manual input', async () => {
      mockFiles.set(mockEnvPath, 'TEST_KEY=test_value')
      let callCount = 0
      mockQuestion.mockImplementation(
        (_prompt: string, callback: (answer: string) => void) => {
          callCount++
          if (callCount === 1) {
            callback('manual')
          } else if (callCount === 2) {
            callback('') // Empty input
          }
        },
      )

      const result = await selectEnvVarsInteractively(mockRL)
      expect(result).toEqual({})
    })

    it('should select all env vars when all numbers are entered', async () => {
      mockFiles.set(mockEnvPath, 'KEY1=value1\nKEY2=value2\nKEY3=value3')
      let callCount = 0
      mockQuestion.mockImplementation(
        (_prompt: string, callback: (answer: string) => void) => {
          callCount++
          if (callCount === 1) {
            callback('1')
          } else if (callCount === 2) {
            callback('2')
          } else if (callCount === 3) {
            callback('3')
          } else if (callCount === 4) {
            callback('done')
          }
        },
      )

      const result = await selectEnvVarsInteractively(mockRL)
      expect(result).toEqual({
        // biome-ignore lint/suspicious/noTemplateCurlyInString: This is the expected format
        KEY1: '${KEY1}',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: This is the expected format
        KEY2: '${KEY2}',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: This is the expected format
        KEY3: '${KEY3}',
      })
    })
  })
})
