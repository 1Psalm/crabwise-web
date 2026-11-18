import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Input from './Input'

describe('Input accessibility wiring (#797)', () => {
  it('describes the field with both the error and the hint when both are present', () => {
    render(<Input label="Email" error="Enter a valid email." hint="Use your work email." />)

    const input = screen.getByLabelText('Email')
    const describedBy = input.getAttribute('aria-describedby') ?? ''

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(describedBy).toContain(`${input.id}-error`)
    expect(describedBy).toContain(`${input.id}-hint`)
    expect(screen.getByText('Enter a valid email.')).toBeInTheDocument()
    expect(screen.getByText('Use your work email.')).toBeInTheDocument()
  })

  it('describes the field with the hint alone when there is no error', () => {
    render(<Input label="Email" hint="Use your work email." />)

    const input = screen.getByLabelText('Email')

    expect(input).toHaveAttribute('aria-describedby', `${input.id}-hint`)
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('merges a caller-supplied aria-describedby instead of replacing its own', () => {
    render(<Input label="Email" error="Required." aria-describedby="external-help" />)

    const input = screen.getByLabelText('Email')
    const describedBy = input.getAttribute('aria-describedby') ?? ''

    expect(describedBy).toContain('external-help')
    expect(describedBy).toContain(`${input.id}-error`)
  })

  it('keeps its own invalid state when a caller passes aria-invalid', () => {
    render(<Input label="Email" error="Required." aria-invalid={false} />)

    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('still forwards ordinary input props to the field', async () => {
    const user = userEvent.setup()
    let typed = ''
    render(
      <Input
        label="Email"
        onChange={(event) => {
          typed = event.target.value
        }}
      />,
    )

    await user.type(screen.getByLabelText('Email'), 'hi')

    expect(typed).toBe('hi')
  })

  it('does not retain aria-invalid or aria-describedby when error is cleared (#114)', () => {
    const { rerender } = render(<Input label="Email" error="Required." />)

    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(`${input.id}-error`)

    rerender(<Input label="Email" error={null} />)

    expect(input).not.toHaveAttribute('aria-invalid')
    // error node is gone so the error id is no longer in describedby
    expect(input.getAttribute('aria-describedby') ?? '').not.toContain(`${input.id}-error`)
  })

  it('error message has role alert and aria-live so it is announced on appearance (#114)', () => {
    render(<Input label="Email" error="Invalid email address." />)

    const errorEl = screen.getByRole('alert')
    expect(errorEl).toHaveAttribute('aria-live', 'polite')
    expect(errorEl).toHaveTextContent('Invalid email address.')
  })
})
