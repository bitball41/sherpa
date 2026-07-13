pub mod error;

use error::{Result, RewriterError};
use js_sys::{Function, Object, Reflect};
use jsr::{JsRewriter, JsRewriterOutput, create_js, create_js_output, get_js_flags};
use oxc::allocator::Allocator;
use wasm_bindgen::prelude::*;
use web_sys::Url;

mod jsr;

#[wasm_bindgen]
extern "C" {
	#[wasm_bindgen(js_namespace = console, js_name = error)]
	fn console_error(s: &str);
	#[wasm_bindgen(js_namespace = console, js_name = error)]
	fn console_error2(s: &JsValue);
}

fn get_obj(obj: &JsValue, k: &'static str) -> Result<JsValue> {
	Ok(Reflect::get(obj, &k.into())?)
}

fn get_str(obj: &JsValue, k: &'static str) -> Result<String> {
	Reflect::get(obj, &k.into())?
		.as_string()
		.ok_or_else(|| RewriterError::not_str(k))
}

fn set_obj(obj: &Object, k: &str, v: &JsValue) -> Result<()> {
	if Reflect::set(&obj.into(), &k.into(), v)? {
		Ok(())
	} else {
		Err(RewriterError::ReflectSetFail(k.to_string()))
	}
}

fn get_flag(sherpa: &Object, url: &str, flag: &str) -> Result<bool> {
	let fenabled = get_obj(sherpa, "flagEnabled")?
		.dyn_into::<Function>()
		.map_err(|_| RewriterError::not_fn("sherpa.flagEnabled"))?;
	let ret = fenabled.call2(&JsValue::NULL, &flag.into(), &Url::new(url)?.into())?;

	ret.as_bool()
		.ok_or_else(|| RewriterError::not_bool("sherpa.flagEnabled return value"))
}

#[wasm_bindgen]
pub struct Rewriter {
	alloc: Allocator,

	sherpa: Object,
	js: JsRewriter,
}

#[wasm_bindgen]
impl Rewriter {
	#[wasm_bindgen(constructor)]
	pub fn new(sherpa: Object) -> Result<Self> {
		Ok(Self {
			alloc: Allocator::default(),

			js: create_js(&sherpa)?,
			sherpa,
		})
	}

	#[wasm_bindgen]
	pub fn rewrite_js(
		&mut self,
		js: String,
		base: String,
		url: String,
		module: bool,
	) -> Result<JsRewriterOutput> {
		let flags = get_js_flags(&self.sherpa, base, module)?;

		let out = match self.js.rewrite(&self.alloc, &js, flags) {
			Ok(x) => x,
			Err(x) => {
				self.alloc.reset();
				Err(x)?
			}
		};

		let ret = create_js_output(out, url, js);

		self.alloc.reset();
		ret
	}

	#[wasm_bindgen]
	pub fn rewrite_js_bytes(
		&mut self,
		js: Vec<u8>,
		base: String,
		url: String,
		module: bool,
	) -> Result<JsRewriterOutput> {
		let js = String::from_utf8_lossy(&js).into_owned();

		self.rewrite_js(js, base, url, module)
	}

}
