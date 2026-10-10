import { ValidationArguments, ValidationOptions, registerDecorator } from 'class-validator';

/**
 * Cross-field validator — e.g. `@IsEqualTo('password')` on a
 * `confirmPassword` field. Used by signup/reset-password DTOs so a
 * mismatched confirmation is rejected with a normal 400, not silently
 * ignored (only the primary field's value is ever persisted).
 */
export function IsEqualTo(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isEqualTo',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [property],
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints;
          const relatedValue = (args.object as Record<string, unknown>)[relatedPropertyName];
          return value === relatedValue;
        },
        defaultMessage(args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints;
          return `${args.property} must match ${relatedPropertyName}`;
        },
      },
    });
  };
}
