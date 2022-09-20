import assert from 'assert';
import NodeUtil from 'util';
import wkx from 'wkx';
import type { Rangable, Range } from '../../model.js';
import { isString } from '../../utils/index.js';
import * as BaseTypes from '../abstract/data-types';
import type {
  AcceptableTypeOf,
  StringifyOptions,
  BindParamOptions, ToSqlOptions,
} from '../abstract/data-types';
import { createDataTypesWarn } from '../abstract/data-types-utils.js';
import type { AbstractDialect } from '../abstract/index.js';
import * as Hstore from './hstore';
import { PostgresQueryGenerator } from './query-generator';
import * as RangeParser from './range';

const warn = createDataTypesWarn('https://www.postgresql.org/docs/current/datatype.html');

/**
 * Removes unsupported Postgres options, i.e., LENGTH, UNSIGNED and ZEROFILL, for the integer data types.
 *
 * @param dataType The base integer data type.
 * @private
 */
function removeUnsupportedIntegerOptions(dataType: BaseTypes.NUMBER) {
  if (
    dataType.options.length
    || dataType.options.unsigned
    || dataType.options.zerofill
  ) {
    warn(`PostgresSQL does not support '${dataType.constructor.name}' with LENGTH, UNSIGNED or ZEROFILL. Plain '${dataType.constructor.name}' will be used instead.`);

    delete dataType.options.length;
    delete dataType.options.unsigned;
    delete dataType.options.zerofill;
  }
}

export class DATEONLY extends BaseTypes.DATEONLY {
  toBindableValue(value: AcceptableTypeOf<BaseTypes.DATEONLY>, options: StringifyOptions) {
    if (value === Number.POSITIVE_INFINITY) {
      return 'infinity';
    }

    if (value === Number.NEGATIVE_INFINITY) {
      return '-infinity';
    }

    return super.toBindableValue(value, options);
  }

  sanitize(value: unknown): unknown {
    if (value === Number.POSITIVE_INFINITY
        || value === Number.NEGATIVE_INFINITY) {
      return value;
    }

    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'infinity') {
        return Number.POSITIVE_INFINITY;
      }

      if (lower === '-infinity') {
        return Number.NEGATIVE_INFINITY;
      }
    }

    return super.sanitize(value);
  }

  parse(value: unknown) {
    if (value === 'infinity') {
      return Number.POSITIVE_INFINITY;
    }

    if (value === '-infinity') {
      return Number.NEGATIVE_INFINITY;
    }

    return value;
  }
}

export class DECIMAL extends BaseTypes.DECIMAL {
  parse(value: unknown) {
    if (value === 'NaN') {
      return Number.NaN;
    }

    return value;
  }

  validate(value: any) {
    // postgres supports NaN
    if (Number.isNaN(value)) {
      return;
    }

    super.validate(value);
  }
}

export class STRING extends BaseTypes.STRING {
  protected _checkOptionSupport(dialect: AbstractDialect) {
    if (this.options.length && this.options.binary) {
      warn(
        `${dialect.name} does not support specifying a length on binary strings. Use a length validator instead.`,
      );

      this.options.length = undefined;
    }
  }

  toSql(options: ToSqlOptions) {
    if (this.options.binary) {
      return 'BYTEA';
    }

    return super.toSql(options);
  }
}

export class TEXT extends BaseTypes.TEXT {
  protected _checkOptionSupport(dialect: AbstractDialect) {
    if (this.options.length) {
      warn(
        `${dialect.name} does not support TEXT with options. Plain \`TEXT\` will be used instead.`,
      );

      this.options.length = undefined;
    }
  }
}

export class BOOLEAN extends BaseTypes.BOOLEAN {
  toSql() {
    return 'BOOLEAN';
  }
}

export class DATE extends BaseTypes.DATE {
  toSql() {
    if (this.options.precision != null) {
      return `TIMESTAMP(${this.options.precision}) WITH TIME ZONE`;
    }

    return 'TIMESTAMP WITH TIME ZONE';
  }

  validate(value: any) {
    if (value === Number.POSITIVE_INFINITY
        || value === Number.NEGATIVE_INFINITY) {
      // valid
      return;
    }

    super.validate(value);
  }

  toBindableValue(
    value: AcceptableTypeOf<BaseTypes.DATE>,
    options: StringifyOptions,
  ): string {
    if (value === Number.POSITIVE_INFINITY) {
      return options.escape('infinity');
    }

    if (value === Number.NEGATIVE_INFINITY) {
      return options.escape('-infinity');
    }

    return super.toBindableValue(value, options);
  }

  sanitize(value: unknown) {
    if (value == null) {
      return value;
    }

    if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
      return value;
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'infinity') {
        return Number.POSITIVE_INFINITY;
      }

      if (lower === '-infinity') {
        return Number.NEGATIVE_INFINITY;
      }
    }

    return super.sanitize(value);
  }

  parse(value: unknown): unknown {
    // return dates as string, not Date objects. Different implementations could be used instead (such as Temporal, dayjs)
    return value;
  }
}

export class SMALLINT extends BaseTypes.SMALLINT {
  protected _checkOptionSupport() {
    removeUnsupportedIntegerOptions(this);
  }
}

export class INTEGER extends BaseTypes.INTEGER {
  protected _checkOptionSupport() {
    removeUnsupportedIntegerOptions(this);
  }
}

export class BIGINT extends BaseTypes.BIGINT {
  protected _checkOptionSupport() {
    removeUnsupportedIntegerOptions(this);
  }
}

export class REAL extends BaseTypes.REAL {
  protected _checkOptionSupport() {
    removeUnsupportedIntegerOptions(this);
  }
}

export class DOUBLE extends BaseTypes.DOUBLE {
  protected _checkOptionSupport() {
    removeUnsupportedIntegerOptions(this);
  }

  protected getNumberSqlTypeName(): string {
    return 'DOUBLE PRECISION';
  }
}

export class FLOAT extends BaseTypes.FLOAT {
  protected _checkOptionSupport() {
    // POSTGRES does only support lengths as parameter.
    // Values between 1-24 result in REAL
    // Values between 25-53 result in DOUBLE PRECISION
    // If decimals are provided remove these and print a warning
    if (this.options.decimals) {
      warn(
        'PostgreSQL does not support FLOAT with decimals. Plain `FLOAT` will be used instead.',
      );
      this.options.length = undefined;
      this.options.decimals = undefined;
    }

    if (this.options.unsigned) {
      warn(
        'PostgreSQL does not support FLOAT unsigned. `UNSIGNED` was removed.',
      );
      this.options.unsigned = undefined;
    }

    if (this.options.zerofill) {
      warn(
        'PostgreSQL does not support FLOAT zerofill. `ZEROFILL` was removed.',
      );
      this.options.zerofill = undefined;
    }
  }
}

export class BLOB extends BaseTypes.BLOB {
  protected _checkOptionSupport() {
    if (this.options.length) {
      warn(
        'PostgreSQL does not support BLOB (BYTEA) with options. Plain `BYTEA` will be used instead.',
      );
      this.options.length = undefined;
    }
  }

  toSql() {
    return 'BYTEA';
  }
}

export class GEOMETRY extends BaseTypes.GEOMETRY {
  toSql() {
    let result = 'GEOMETRY';
    if (this.options.type) {
      result += `(${this.options.type.toUpperCase()}`;
      if (this.options.srid) {
        result += `,${this.options.srid}`;
      }

      result += ')';
    }

    return result;
  }

  parse(value: string) {
    const b = Buffer.from(value, 'hex');

    return wkx.Geometry.parse(b).toGeoJSON({ shortCrs: true });
  }

  toBindableValue(value: AcceptableTypeOf<BaseTypes.GEOMETRY>, options: StringifyOptions): string {
    return `ST_GeomFromGeoJSON(${options.escape(JSON.stringify(value))})`;
  }

  bindParam(value: AcceptableTypeOf<BaseTypes.GEOMETRY>, options: BindParamOptions) {
    return `ST_GeomFromGeoJSON(${options.bindParam(value)})`;
  }
}

export class GEOGRAPHY extends BaseTypes.GEOGRAPHY {
  toSql() {
    let result = 'GEOGRAPHY';
    if (this.options.type) {
      result += `(${this.options.type}`;
      if (this.options.srid) {
        result += `,${this.options.srid}`;
      }

      result += ')';
    }

    return result;
  }

  parse(value: string) {
    const b = Buffer.from(value, 'hex');

    return wkx.Geometry.parse(b).toGeoJSON({ shortCrs: true });
  }

  toBindableValue(
    value: AcceptableTypeOf<BaseTypes.GEOGRAPHY>,
    options: StringifyOptions,
  ) {
    return `ST_GeomFromGeoJSON(${options.escape(JSON.stringify(value))})`;
  }

  bindParam(value: AcceptableTypeOf<BaseTypes.GEOGRAPHY>, options: BindParamOptions) {
    return `ST_GeomFromGeoJSON(${options.bindParam(value)})`;
  }
}

export class HSTORE extends BaseTypes.HSTORE {
  toBindableValue(value: AcceptableTypeOf<BaseTypes.HSTORE>): string {
    if (value == null) {
      return value;
    }

    return Hstore.stringify(value);
  }

  parse(value: string) {
    return Hstore.parse(value);
  }
}

export class RANGE<T extends BaseTypes.NUMBER | DATE | DATEONLY = INTEGER> extends BaseTypes.RANGE<T> {
  #parseSubType = (val: string) => this.options.subtype.parse(val);

  toBindableValue(values: Rangable<AcceptableTypeOf<T>>, options: StringifyOptions) {
    if (!Array.isArray(values)) {
      return this.options.subtype.toBindableValue(values, options);
    }

    return RangeParser.stringify(values, rangePart => {
      const out = this.options.subtype.toBindableValue(rangePart, options);

      if (!isString(out)) {
        throw new Error('DataTypes.RANGE only accepts types that can be stringified.');
      }

      return out;
    });
  }

  escape(values: Rangable<AcceptableTypeOf<T>>, options: StringifyOptions): string {
    const value = this.toBindableValue(values, options);
    if (!Array.isArray(values)) {
      return `'${value}'::${this.#toCastType()}`;
    }

    return `'${value}'`;
  }

  bindParam(
    values: Rangable<AcceptableTypeOf<T>>,
    options: BindParamOptions,
  ): string {
    const value = this.toBindableValue(values, options);
    if (!Array.isArray(values)) {
      return `${options.bindParam(value ?? '')}::${this.#toCastType()}`;
    }

    return options.bindParam(value);
  }

  toSql() {
    const subTypeClass = this.options.subtype.constructor as typeof BaseTypes.AbstractDataType;

    return RANGE.typeMap.subTypes[subTypeClass.getDataTypeId().toLowerCase()];
  }

  #toCastType(): string {
    const subTypeClass = this.options.subtype.constructor as typeof BaseTypes.AbstractDataType;

    return RANGE.typeMap.castTypes[subTypeClass.getDataTypeId().toLowerCase()];
  }

  static typeMap: { subTypes: Record<string, string>, castTypes: Record<string, string> } = {
    subTypes: {
      integer: 'int4range',
      decimal: 'numrange',
      date: 'tstzrange',
      dateonly: 'daterange',
      bigint: 'int8range',
    },
    castTypes: {
      integer: 'int4',
      decimal: 'numeric',
      date: 'timestamptz',
      dateonly: 'date',
      bigint: 'int8',
    },
  };

  parse(value: unknown): Range<unknown> {
    if (typeof value !== 'string') {
      throw new TypeError(NodeUtil.format(`Sequelize could not parse range "%O" as its format is incompatible`, value));
    }

    return RangeParser.parse(value, this.#parseSubType);
  }
}

export class ARRAY<T extends BaseTypes.AbstractDataType<any>> extends BaseTypes.ARRAY<T> {
  escape(
    values: Array<AcceptableTypeOf<T>>,
    options: StringifyOptions,
  ) {
    const type = this.options.type;

    return `ARRAY[${values.map((value: any) => {
      return type.escape(value, options);
    }).join(',')}]::${type.toSql(options)}[]`;
  }

  bindParam(
    values: Array<AcceptableTypeOf<T>>,
    options: BindParamOptions,
  ) {
    return options.bindParam(values.map((value: any) => {
      return this.options.type.toBindableValue(value, options);
    }));
  }
}

export class ENUM<Members extends string> extends BaseTypes.ENUM<Members> {
  override toSql(): string {
    const context = this.usageContext;
    if (context == null) {
      throw new Error('Could not determine the name of this enum because it is not attached to an attribute or a column.');
    }

    let tableName;
    let columnName;
    if ('model' in context) {
      tableName = context.model.getTableName();

      const attribute = context.model.getAttributes()[context.attributeName];
      columnName = attribute.field ?? context.attributeName;
    } else {
      tableName = context.tableName;
      columnName = context.columnName;
    }

    const queryGenerator = context.sequelize.dialect.queryGenerator;

    assert(queryGenerator instanceof PostgresQueryGenerator, 'expected queryGenerator to be PostgresQueryGenerator');

    return queryGenerator.pgEnumName(tableName, columnName);
  }
}
