import { describe, expect, it } from 'vitest'

import { deliveryDisplayLabel, deliveryOptionsForValue } from './index'

describe('cron delivery options', () => {
  it('surfaces origin as a first-class delivery option', () => {
    expect(deliveryOptionsForValue('origin').some(option => option.value === 'origin')).toBe(true)
    expect(deliveryDisplayLabel('origin')).toBe('Origin chat')
  })

  it('keeps saved explicit targets visible instead of rendering a blank select', () => {
    const options = deliveryOptionsForValue('telegram:Yantor (dm)')

    expect(options[options.length - 1]).toEqual({
      label: 'Custom: telegram:Yantor (dm)',
      value: 'telegram:Yantor (dm)'
    })
  })

  it('does not duplicate known targets', () => {
    const telegramOptions = deliveryOptionsForValue('telegram').filter(option => option.value === 'telegram')

    expect(telegramOptions).toHaveLength(1)
  })
})
