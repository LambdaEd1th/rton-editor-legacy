use serde_rton::{
    BinaryBlob, Rtid, Value, VarInt, decrypt_data, encrypt_data, from_bytes, to_bytes,
    to_compact_bytes,
};
use std::str::FromStr;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn decode_rton_to_value(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    let value: Value = from_bytes(bytes).map_err(js_error)?;
    Ok(encode_value_wire(&value))
}

#[wasm_bindgen]
pub fn encode_value_to_rton(value_wire: &[u8], compact: bool) -> Result<Vec<u8>, JsValue> {
    let value = decode_value_wire(value_wire).map_err(js_error)?;
    if compact {
        to_compact_bytes(&value).map_err(js_error)
    } else {
        to_bytes(&value).map_err(js_error)
    }
}

#[wasm_bindgen]
pub fn encrypt_rton_data(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    encrypt_data(bytes).map_err(js_error)
}

#[wasm_bindgen]
pub fn decrypt_rton_data(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    decrypt_data(bytes).map_err(js_error)
}

#[wasm_bindgen]
pub fn value_to_json_text(value_wire: &[u8], pretty: bool) -> Result<String, JsValue> {
    let value = decode_value_wire(value_wire).map_err(js_error)?;
    ensure_json_safe_value(&value).map_err(js_error)?;
    if pretty {
        serde_json::to_string_pretty(&value).map_err(js_error)
    } else {
        serde_json::to_string(&value).map_err(js_error)
    }
}

#[wasm_bindgen]
pub fn json_text_to_value(json: &str) -> Result<Vec<u8>, JsValue> {
    let value = parse_editor_json(json).map_err(js_error)?;
    Ok(encode_value_wire(&value))
}

fn parse_editor_json(json: &str) -> Result<Value, String> {
    match serde_json::from_str::<Value>(json) {
        Ok(mut value) => {
            normalize_editor_value(&mut value);
            Ok(value)
        }
        Err(primary_error) => {
            let json_value = serde_json::from_str::<serde_json::Value>(json)
                .map_err(|secondary_error| format!("Invalid JSON: {secondary_error}"))?;
            json_value_to_rton(json_value).map_err(|conversion_error| {
                format!("{primary_error}; fallback conversion failed: {conversion_error}")
            })
        }
    }
}

fn normalize_editor_value(value: &mut Value) {
    match value {
        Value::String(text) if text.starts_with("$BINARY(") => {
            if let Ok(blob) = BinaryBlob::from_str(text) {
                *value = Value::Binary(blob);
            }
        }
        Value::Array(items) => {
            for item in items {
                normalize_editor_value(item);
            }
        }
        Value::Object(entries) => {
            for (_, item) in entries {
                normalize_editor_value(item);
            }
        }
        _ => {}
    }
}

fn json_value_to_rton(value: serde_json::Value) -> Result<Value, String> {
    match value {
        serde_json::Value::Null => Ok(Value::Rtid(Rtid::Null)),
        serde_json::Value::Bool(value) => Ok(Value::Bool(value)),
        serde_json::Value::Number(number) => {
            if let Some(value) = number.as_i64() {
                Ok(Value::new_int(value))
            } else if let Some(value) = number.as_u64() {
                Ok(Value::new_uint(value))
            } else if let Some(value) = number.as_f64() {
                Ok(Value::Double(value))
            } else {
                Err(format!("Unsupported JSON number: {number}"))
            }
        }
        serde_json::Value::String(text) => {
            if text.starts_with("RTID(") {
                Rtid::from_str(&text)
                    .map(Value::Rtid)
                    .map_err(|error| error.to_string())
            } else if text.starts_with("$BINARY(") {
                BinaryBlob::from_str(&text)
                    .map(Value::Binary)
                    .map_err(|error| error.to_string())
            } else {
                Ok(Value::String(text))
            }
        }
        serde_json::Value::Array(items) => items
            .into_iter()
            .map(json_value_to_rton)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        serde_json::Value::Object(map) => map
            .into_iter()
            .map(|(key, value)| json_value_to_rton(value).map(|value| (key, value)))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Object),
    }
}

fn ensure_json_safe_value(value: &Value) -> Result<(), String> {
    match value {
        Value::Float(value) if !value.is_finite() => Err(format!(
            "JSON does not support non-finite number: {}",
            describe_non_finite(*value as f64)
        )),
        Value::Double(value) if !value.is_finite() => Err(format!(
            "JSON does not support non-finite number: {}",
            describe_non_finite(*value)
        )),
        Value::Array(items) => {
            for item in items {
                ensure_json_safe_value(item)?;
            }
            Ok(())
        }
        Value::Object(entries) => {
            for (_, item) in entries {
                ensure_json_safe_value(item)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn describe_non_finite(value: f64) -> &'static str {
    if value.is_nan() {
        "NaN"
    } else if value.is_sign_negative() {
        "-Infinity"
    } else {
        "Infinity"
    }
}

fn js_error(error: impl ToString) -> JsValue {
    JsValue::from_str(&error.to_string())
}

const WIRE_NULL: u8 = 0;
const WIRE_BOOL: u8 = 1;
const WIRE_I8: u8 = 2;
const WIRE_U8: u8 = 3;
const WIRE_I16: u8 = 4;
const WIRE_U16: u8 = 5;
const WIRE_I32: u8 = 6;
const WIRE_U32: u8 = 7;
const WIRE_I64: u8 = 8;
const WIRE_U64: u8 = 9;
const WIRE_VAR_I32: u8 = 10;
const WIRE_VAR_U32: u8 = 11;
const WIRE_VAR_I64: u8 = 12;
const WIRE_VAR_U64: u8 = 13;
const WIRE_F32: u8 = 14;
const WIRE_F64: u8 = 15;
const WIRE_STRING: u8 = 16;
const WIRE_BINARY: u8 = 17;
const WIRE_RTID: u8 = 18;
const WIRE_ARRAY: u8 = 19;
const WIRE_OBJECT: u8 = 20;

fn encode_value_wire(value: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    write_value_wire(value, &mut out);
    out
}

fn write_value_wire(value: &Value, out: &mut Vec<u8>) {
    match value {
        Value::Null => out.push(WIRE_NULL),
        Value::Bool(value) => {
            out.push(WIRE_BOOL);
            out.push(u8::from(*value));
        }
        Value::Int8(value) => {
            out.push(WIRE_I8);
            out.push(*value as u8);
        }
        Value::UInt8(value) => {
            out.push(WIRE_U8);
            out.push(*value);
        }
        Value::Int16(value) => {
            out.push(WIRE_I16);
            out.extend_from_slice(&value.to_le_bytes());
        }
        Value::UInt16(value) => {
            out.push(WIRE_U16);
            out.extend_from_slice(&value.to_le_bytes());
        }
        Value::Int32(value) => {
            out.push(WIRE_I32);
            out.extend_from_slice(&value.to_le_bytes());
        }
        Value::UInt32(value) => {
            out.push(WIRE_U32);
            out.extend_from_slice(&value.to_le_bytes());
        }
        Value::Int64(value) => {
            out.push(WIRE_I64);
            out.extend_from_slice(&value.to_le_bytes());
        }
        Value::UInt64(value) => {
            out.push(WIRE_U64);
            out.extend_from_slice(&value.to_le_bytes());
        }
        Value::VarIntI32(value) => {
            out.push(WIRE_VAR_I32);
            out.extend_from_slice(&value.0.to_le_bytes());
        }
        Value::VarIntU32(value) => {
            out.push(WIRE_VAR_U32);
            out.extend_from_slice(&value.0.to_le_bytes());
        }
        Value::VarIntI64(value) => {
            out.push(WIRE_VAR_I64);
            out.extend_from_slice(&value.0.to_le_bytes());
        }
        Value::VarIntU64(value) => {
            out.push(WIRE_VAR_U64);
            out.extend_from_slice(&value.0.to_le_bytes());
        }
        Value::Float(value) => {
            out.push(WIRE_F32);
            out.extend_from_slice(&value.to_le_bytes());
        }
        Value::Double(value) => {
            out.push(WIRE_F64);
            out.extend_from_slice(&value.to_le_bytes());
        }
        Value::String(value) => {
            out.push(WIRE_STRING);
            write_wire_string(value, out);
        }
        Value::Binary(value) => {
            out.push(WIRE_BINARY);
            write_wire_string(&value.to_string(), out);
        }
        Value::Rtid(value) => {
            out.push(WIRE_RTID);
            write_wire_string(&value.to_string(), out);
        }
        Value::Array(items) => {
            out.push(WIRE_ARRAY);
            write_wire_len(items.len(), out);
            for item in items {
                write_value_wire(item, out);
            }
        }
        Value::Object(entries) => {
            out.push(WIRE_OBJECT);
            write_wire_len(entries.len(), out);
            for (key, value) in entries {
                write_wire_string(key, out);
                write_value_wire(value, out);
            }
        }
    }
}

fn write_wire_len(len: usize, out: &mut Vec<u8>) {
    let len = u32::try_from(len).expect("RtonValue wire length exceeds u32");
    out.extend_from_slice(&len.to_le_bytes());
}

fn write_wire_string(value: &str, out: &mut Vec<u8>) {
    let bytes = value.as_bytes();
    write_wire_len(bytes.len(), out);
    out.extend_from_slice(bytes);
}

struct WireReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

fn decode_value_wire(bytes: &[u8]) -> Result<Value, String> {
    let mut reader = WireReader { bytes, offset: 0 };
    let value = reader.read_value()?;
    if reader.offset != reader.bytes.len() {
        return Err("Trailing bytes after RtonValue wire payload".into());
    }
    Ok(value)
}

impl<'a> WireReader<'a> {
    fn read_value(&mut self) -> Result<Value, String> {
        let tag = self.read_u8()?;
        match tag {
            WIRE_NULL => Ok(Value::Null),
            WIRE_BOOL => Ok(Value::Bool(self.read_u8()? != 0)),
            WIRE_I8 => Ok(Value::Int8(self.read_u8()? as i8)),
            WIRE_U8 => Ok(Value::UInt8(self.read_u8()?)),
            WIRE_I16 => Ok(Value::Int16(i16::from_le_bytes(self.read_array()?))),
            WIRE_U16 => Ok(Value::UInt16(u16::from_le_bytes(self.read_array()?))),
            WIRE_I32 => Ok(Value::Int32(i32::from_le_bytes(self.read_array()?))),
            WIRE_U32 => Ok(Value::UInt32(u32::from_le_bytes(self.read_array()?))),
            WIRE_I64 => Ok(Value::Int64(i64::from_le_bytes(self.read_array()?))),
            WIRE_U64 => Ok(Value::UInt64(u64::from_le_bytes(self.read_array()?))),
            WIRE_VAR_I32 => Ok(Value::VarIntI32(VarInt(i32::from_le_bytes(self.read_array()?)))),
            WIRE_VAR_U32 => Ok(Value::VarIntU32(VarInt(u32::from_le_bytes(self.read_array()?)))),
            WIRE_VAR_I64 => Ok(Value::VarIntI64(VarInt(i64::from_le_bytes(self.read_array()?)))),
            WIRE_VAR_U64 => Ok(Value::VarIntU64(VarInt(u64::from_le_bytes(self.read_array()?)))),
            WIRE_F32 => Ok(Value::Float(f32::from_le_bytes(self.read_array()?))),
            WIRE_F64 => Ok(Value::Double(f64::from_le_bytes(self.read_array()?))),
            WIRE_STRING => Ok(Value::String(self.read_string()?)),
            WIRE_BINARY => BinaryBlob::from_str(&self.read_string()?)
                .map(Value::Binary)
                .map_err(|error| error.to_string()),
            WIRE_RTID => Rtid::from_str(&self.read_string()?)
                .map(Value::Rtid)
                .map_err(|error| error.to_string()),
            WIRE_ARRAY => {
                let len = self.read_len()?;
                let mut items = Vec::with_capacity(len);
                for _ in 0..len {
                    items.push(self.read_value()?);
                }
                Ok(Value::Array(items))
            }
            WIRE_OBJECT => {
                let len = self.read_len()?;
                let mut entries = Vec::with_capacity(len);
                for _ in 0..len {
                    let key = self.read_string()?;
                    let value = self.read_value()?;
                    entries.push((key, value));
                }
                Ok(Value::Object(entries))
            }
            _ => Err(format!("Unknown RtonValue wire tag: {tag}")),
        }
    }

    fn read_u8(&mut self) -> Result<u8, String> {
        if self.offset >= self.bytes.len() {
            return Err("Unexpected end of RtonValue wire payload".into());
        }
        let value = self.bytes[self.offset];
        self.offset += 1;
        Ok(value)
    }

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N], String> {
        if self.offset + N > self.bytes.len() {
            return Err("Unexpected end of RtonValue wire payload".into());
        }
        let mut out = [0u8; N];
        out.copy_from_slice(&self.bytes[self.offset..self.offset + N]);
        self.offset += N;
        Ok(out)
    }

    fn read_len(&mut self) -> Result<usize, String> {
        Ok(u32::from_le_bytes(self.read_array()?) as usize)
    }

    fn read_string(&mut self) -> Result<String, String> {
        let len = self.read_len()?;
        if self.offset + len > self.bytes.len() {
            return Err("Unexpected end of RtonValue wire string".into());
        }
        let value = std::str::from_utf8(&self.bytes[self.offset..self.offset + len])
            .map_err(|error| error.to_string())?
            .to_string();
        self.offset += len;
        Ok(value)
    }
}
