import { EndpointControlController } from './endpoint-control.controller';
import { WazuhActiveResponseProvider } from './wazuh-active-response.provider';

describe('EndpointControlController', () => {
  function build() {
    const wazuhProvider = { reportExecutionResult: jest.fn().mockReturnValue(true) } as unknown as WazuhActiveResponseProvider;
    return { controller: new EndpointControlController(wazuhProvider), wazuhProvider };
  }

  it('forwards the real reported result to WazuhActiveResponseProvider unchanged', () => {
    const { controller, wazuhProvider } = build();

    controller.reportResult({ hostname: 'WEB-01', success: true, detail: 'Isolation applied.' });

    expect(wazuhProvider.reportExecutionResult).toHaveBeenCalledWith(
      'WEB-01',
      true,
      'Isolation applied.',
    );
  });

  it('forwards a real failure report exactly as received — never rewrites it to success', () => {
    const { controller, wazuhProvider } = build();

    controller.reportResult({ hostname: 'WEB-01', success: false, detail: 'iptables-save failed.' });

    expect(wazuhProvider.reportExecutionResult).toHaveBeenCalledWith(
      'WEB-01',
      false,
      'iptables-save failed.',
    );
  });
});
